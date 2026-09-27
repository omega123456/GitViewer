use crate::{error::Result, git, repo::Repo};
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

pub fn start(repo: &Repo, changed: impl Fn(Change) + Send + Sync + 'static) -> Result<()> {
    let mut watchers = repo
        .watchers
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !watchers.is_empty() {
        return Ok(());
    }
    let root = repo.root.clone();
    let stale = repo.stale.clone();
    let history_stale = repo.history_stale.clone();
    let metadata = repo.root.join(".git");
    let head = metadata.join("HEAD");
    let packed = metadata.join("packed-refs");
    let references = metadata.join("refs");
    let notify = Arc::new(changed);
    let working_tree_notify = notify.clone();
    let working_tree_stale = stale.clone();
    let mut working_tree = debouncer(WORKING_TREE_INTERVAL, move |result: DebounceEventResult| {
        if result
            .as_ref()
            .is_ok_and(|events| ignored_only(&root, events))
        {
            working_tree_notify(Change::Files);
        } else {
            working_tree_stale.store(true, Ordering::SeqCst);
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
        let head_changed = result.as_ref().map_or(true, |events| {
            events
                .iter()
                .flat_map(|event| &event.paths)
                .any(|path| path == &head || path == &packed || path.starts_with(&referenced))
        });
        stale.store(true, Ordering::SeqCst);
        if head_changed {
            history_stale.store(true, Ordering::SeqCst);
        }
        notify(if head_changed {
            Change::Head
        } else {
            Change::Status
        });
    })?;
    git_metadata.watch(&metadata, RecursiveMode::NonRecursive)?;
    if references.is_dir() {
        git_metadata.watch(&references, RecursiveMode::Recursive)?;
    }
    *watchers = vec![working_tree, git_metadata];
    Ok(())
}
