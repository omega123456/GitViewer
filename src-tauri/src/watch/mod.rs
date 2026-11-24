use crate::{
    error::Result,
    git,
    lock::lock_recovering,
    repo::{Repo, Repository},
};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    DebounceEventResult, DebouncedEvent, Debouncer, NoCache, new_debouncer_opt,
};
use std::{
    collections::BTreeSet,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Weak},
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
                .filter(|part| !part.eq_ignore_ascii_case(git::DOT_GIT)),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    (!parts.is_empty()).then(|| parts.join(git::PATH_SEPARATOR))
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
    let metadata = root.join(git::DOT_GIT);
    let mut paths = events.iter().flat_map(|event| &event.paths).peekable();
    let any_paths = paths.peek().is_some();
    any_paths && paths.all(|path| path == &metadata)
}

type Notifier = Arc<dyn Fn(Change) + Send + Sync>;

struct WorkingTree {
    root: PathBuf,
    stale: Arc<AtomicBool>,
    notify: Notifier,
}
impl WorkingTree {
    fn touches_only_metadata(&self, result: &DebounceEventResult) -> bool {
        result
            .as_ref()
            .is_ok_and(|events| metadata_only(&self.root, events))
    }
    fn touches_only_ignored(&self, result: &DebounceEventResult) -> bool {
        result
            .as_ref()
            .is_ok_and(|events| ignored_only(&self.root, events))
    }
    fn handle(&self, result: DebounceEventResult) {
        if self.touches_only_metadata(&result) {
            return;
        }
        if self.touches_only_ignored(&result) {
            (self.notify)(Change::Files);
            return;
        }
        self.stale.store(true, Ordering::SeqCst);
        (self.notify)(Change::Status);
    }
}

struct MetadataPaths {
    git_dir: PathBuf,
    head: PathBuf,
    packed: PathBuf,
    references: PathBuf,
}
impl MetadataPaths {
    fn of(repo: &Repository) -> Self {
        Self {
            git_dir: repo.git_dir.clone(),
            head: repo.git_dir.join(git::HEAD),
            packed: repo.common_dir.join("packed-refs"),
            references: repo.common_dir.join("refs"),
        }
    }
    fn names_reference(&self, path: &Path) -> bool {
        path == self.packed || path.starts_with(&self.references)
    }
    fn is_relevant(&self, path: &Path) -> bool {
        path.starts_with(&self.git_dir) || self.names_reference(path)
    }
    fn moves_head(&self, path: &Path) -> bool {
        path == self.head || self.names_reference(path)
    }
    fn relevant<'a>(&self, events: &'a [DebouncedEvent]) -> Vec<&'a PathBuf> {
        events
            .iter()
            .flat_map(|event| &event.paths)
            .filter(|path| self.is_relevant(path))
            .collect()
    }
}

struct Metadata {
    shared: Weak<Repo>,
    paths: MetadataPaths,
    notify: Notifier,
}
impl Metadata {
    fn mark_stale(&self, repo: &Repo) {
        repo.stale.store(true, Ordering::SeqCst);
        (self.notify)(Change::Status);
    }
    fn reread(&self, repo: &Repo) {
        match tauri::async_runtime::block_on(repo.reread()) {
            Ok(reread) if !reread.changed => {}
            Ok(_) => (self.notify)(Change::Status),
            Err(_) => self.mark_stale(repo),
        }
    }
    fn head_moved(&self, repo: &Repo) {
        repo.stale.store(true, Ordering::SeqCst);
        repo.history_stale.store(true, Ordering::SeqCst);
        (self.notify)(Change::Head);
    }
    fn handle(&self, result: DebounceEventResult) {
        let Some(repo) = self.shared.upgrade() else {
            return;
        };
        let relevant = result.as_ref().map(|events| self.paths.relevant(events));
        let nothing_relevant = relevant.as_ref().is_ok_and(Vec::is_empty);
        if nothing_relevant {
            return;
        }
        let head_changed = relevant.map_or(true, |paths| {
            paths.iter().any(|path| self.paths.moves_head(path))
        });
        if head_changed {
            self.head_moved(&repo);
            return;
        }
        self.reread(&repo);
    }
}

fn watch_working_tree(repo: &Repository, watcher: &mut Watcher) -> Result<()> {
    watcher.watch(&repo.root, RecursiveMode::NonRecursive)?;
    let metadata = repo.root.join(git::DOT_GIT);
    for entry in std::fs::read_dir(&repo.root)? {
        let path = entry?.path();
        let skipped = path == metadata || !path.is_dir();
        if skipped {
            continue;
        }
        watcher.watch(&path, RecursiveMode::Recursive)?;
    }
    Ok(())
}
fn watch_metadata(repo: &Repository, watcher: &mut Watcher, references: &Path) -> Result<()> {
    watcher.watch(&repo.git_dir, RecursiveMode::NonRecursive)?;
    if repo.common_dir != repo.git_dir {
        watcher.watch(&repo.common_dir, RecursiveMode::NonRecursive)?;
    }
    if references.is_dir() {
        watcher.watch(references, RecursiveMode::Recursive)?;
    }
    Ok(())
}

pub fn start(repo: &Repository, changed: impl Fn(Change) + Send + Sync + 'static) -> Result<()> {
    let mut watchers = lock_recovering(&repo.watchers);
    if !watchers.is_empty() {
        return Ok(());
    }
    let notify: Notifier = Arc::new(changed);
    let working = WorkingTree {
        root: repo.root.clone(),
        stale: repo.stale.clone(),
        notify: notify.clone(),
    };
    let mut working_tree = debouncer(WORKING_TREE_INTERVAL, move |result| working.handle(result))?;
    watch_working_tree(repo, &mut working_tree)?;
    let metadata = Metadata {
        shared: Arc::downgrade(repo),
        paths: MetadataPaths::of(repo),
        notify,
    };
    let references = metadata.paths.references.clone();
    let mut git_metadata = debouncer(METADATA_INTERVAL, move |result| metadata.handle(result))?;
    watch_metadata(repo, &mut git_metadata, &references)?;
    *watchers = vec![working_tree, git_metadata];
    Ok(())
}
