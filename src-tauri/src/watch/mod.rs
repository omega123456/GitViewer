use crate::{error::Result, git, repo::Repository};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer_opt, DebounceEventResult, DebouncedEvent, Debouncer, NoCache,
};
use std::{
    collections::BTreeSet,
    path::{Component, Path},
    sync::atomic::Ordering,
    sync::Arc,
    time::Duration,
};

pub type Watcher = Debouncer<RecommendedWatcher, NoCache>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Status,
    Head,
    Files,
}

const WORKING_TREE_INTERVAL: Duration = Duration::from_millis(200);
const METADATA_INTERVAL: Duration = Duration::from_millis(1000);

fn debouncer(
    interval: Duration,
    handler: impl FnMut(DebounceEventResult) + Send + 'static,
) -> Result<Watcher> {
    Ok(new_debouncer_opt(
        interval,
        None,
        handler,
        NoCache::new(),
        notify::Config::default(),
    )?)
}

fn relative(root: &Path, path: &Path) -> Option<String> {
    let parts = path
        .strip_prefix(root)
        .ok()?
        .components()
        .map(|component| match component {
            Component::Normal(part) => part
                .to_str()
                .filter(|part| !part.eq_ignore_ascii_case(".git")),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    (!parts.is_empty()).then(|| parts.join("/"))
}

pub fn ignored_only(root: &Path, events: &[DebouncedEvent]) -> bool {
    let paths = events
        .iter()
        .flat_map(|event| &event.paths)
        .map(|path| relative(root, path))
        .collect::<Option<BTreeSet<_>>>();
    let Some(paths) = paths.filter(|paths| !paths.is_empty()) else {
        return false;
    };
    tauri::async_runtime::block_on(git::ignored(root, paths.iter().map(String::as_str)))
        .is_ok_and(|ignored| paths.iter().all(|path| ignored.contains(path)))
}

pub fn metadata_only(root: &Path, events: &[DebouncedEvent]) -> bool {
    let metadata = root.join(".git");
    let mut paths = events.iter().flat_map(|event| &event.paths).peekable();
    paths.peek().is_some() && paths.all(|path| path == &metadata)
}

pub fn start(repo: &Repository, changed: impl Fn(Change) + Send + Sync + 'static) -> Result<()> {
    let mut watchers = repo
        .watchers
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !watchers.is_empty() {
        return Ok(());
    }
    let root = repo.root.clone();
    let stale = repo.stale.clone();
    let shared = Arc::downgrade(repo);
    let metadata = repo.root.join(".git");
    let git_dir = repo.git_dir.clone();
    let head = git_dir.join("HEAD");
    let packed = repo.common_dir.join("packed-refs");
    let references = repo.common_dir.join("refs");
    let notify = Arc::new(changed);
    let working_tree_notify = notify.clone();
    let mut working_tree = debouncer(WORKING_TREE_INTERVAL, move |result: DebounceEventResult| {
        if result
            .as_ref()
            .is_ok_and(|events| metadata_only(&root, events))
        {
            return;
        }
        if result
            .as_ref()
            .is_ok_and(|events| ignored_only(&root, events))
        {
            working_tree_notify(Change::Files);
        } else {
            stale.store(true, Ordering::SeqCst);
            working_tree_notify(Change::Status);
        }
    })?;
    working_tree.watch(&repo.root, RecursiveMode::NonRecursive)?;
    for entry in std::fs::read_dir(&repo.root)? {
        let path = entry?.path();
        if path == metadata || !path.is_dir() {
            continue;
        }
        working_tree.watch(&path, RecursiveMode::Recursive)?;
    }
    let referenced = references.clone();
    let mut git_metadata = debouncer(METADATA_INTERVAL, move |result: DebounceEventResult| {
        let Some(repo) = shared.upgrade() else {
            return;
        };
        let paths = result.as_ref().map(|events| {
            events
                .iter()
                .flat_map(|event| &event.paths)
                .filter(|path| {
                    path.starts_with(&git_dir) || path == &&packed || path.starts_with(&referenced)
                })
                .collect::<Vec<_>>()
        });
        if paths.as_ref().is_ok_and(Vec::is_empty) {
            return;
        }
        let head_changed = paths.map_or(true, |paths| {
            paths
                .iter()
                .any(|path| *path == &head || *path == &packed || path.starts_with(&referenced))
        });
        if head_changed {
            repo.stale.store(true, Ordering::SeqCst);
            repo.history_stale.store(true, Ordering::SeqCst);
            notify(Change::Head);
            return;
        }
        match tauri::async_runtime::block_on(repo.reread()) {
            Ok(reread) if !reread.changed => {}
            Ok(_) => notify(Change::Status),
            Err(_) => {
                repo.stale.store(true, Ordering::SeqCst);
                notify(Change::Status);
            }
        }
    })?;
    git_metadata.watch(&repo.git_dir, RecursiveMode::NonRecursive)?;
    if repo.common_dir != repo.git_dir {
        git_metadata.watch(&repo.common_dir, RecursiveMode::NonRecursive)?;
    }
    if references.is_dir() {
        git_metadata.watch(&references, RecursiveMode::Recursive)?;
    }
    *watchers = vec![working_tree, git_metadata];
    Ok(())
}
