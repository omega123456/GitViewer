use crate::{error::Result, repo::Repo};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer_opt, DebounceEventResult, Debouncer, NoCache};
use std::{sync::atomic::Ordering, sync::Arc, time::Duration};

pub type Watcher = Debouncer<RecommendedWatcher, NoCache>;

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

pub fn start(repo: &mut Repo, changed: impl Fn(bool) + Send + Sync + 'static) -> Result<()> {
    let stale = repo.stale.clone();
    let history_stale = repo.history_stale.clone();
    let metadata = repo.root.join(".git");
    let head = metadata.join("HEAD");
    let packed = metadata.join("packed-refs");
    let references = metadata.join("refs");
    let notify = Arc::new(changed);
    let working_tree_notify = notify.clone();
    let working_tree_stale = stale.clone();
    let mut working_tree = debouncer(WORKING_TREE_INTERVAL, move |_: DebounceEventResult| {
        working_tree_stale.store(true, Ordering::SeqCst);
        working_tree_notify(false);
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
        notify(head_changed);
    })?;
    git_metadata.watch(&metadata, RecursiveMode::NonRecursive)?;
    if references.is_dir() {
        git_metadata.watch(&references, RecursiveMode::Recursive)?;
    }
    repo.watchers = vec![working_tree, git_metadata];
    Ok(())
}
