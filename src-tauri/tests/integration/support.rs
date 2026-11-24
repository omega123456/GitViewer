use gitviewer_lib::{
    actions::{self, FilesAction},
    diff::{self, Diff, DiffRef, ReadOptions},
    error::Result,
    git,
    repo::{Registry, Repo, Repository},
};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tempfile::TempDir;

pub(super) fn silent() -> impl Fn(&str) {
    |_| {}
}

pub(super) async fn command(root: &Path, args: &[&str]) -> String {
    git::text(root, args).await.unwrap()
}

async fn open_fixture(root: &Path) -> Repository {
    command(root, &["init", "--initial-branch=main"]).await;
    command(root, &["config", "user.name", "Fixture Author"]).await;
    command(root, &["config", "user.email", "fixture@example.invalid"]).await;
    command(root, &["config", "core.autocrlf", "false"]).await;
    let registry = Registry::default();
    let info = registry.open(root.to_str().unwrap()).await.unwrap();
    registry.get(&info.id).await.unwrap()
}

pub(super) async fn fixture() -> (TempDir, Repository) {
    let dir = tempfile::tempdir().unwrap();
    let repo = open_fixture(dir.path()).await;
    (dir, repo)
}

pub(super) async fn fixture_named(name: &str) -> (TempDir, Repository) {
    let holder = tempfile::tempdir().unwrap();
    let root = holder.path().join(name);
    std::fs::create_dir(&root).unwrap();
    let repo = open_fixture(&root).await;
    (holder, repo)
}

pub(super) struct Recorded<'a> {
    pub path: &'a str,
    pub body: &'a str,
    pub message: &'a str,
}

pub(super) async fn record(repo: &Repo, change: Recorded<'_>) {
    std::fs::write(repo.root.join(change.path), change.body).unwrap();
    actions::files(repo, &[change.path.into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(repo, change.message).await.unwrap();
}

pub(super) async fn base(repo: &Repo) {
    record(
        repo,
        Recorded {
            path: "file.txt",
            body: "one\ntwo\nthree\n",
            message: "Initial",
        },
    )
    .await;
}

pub(super) async fn read_diff(repo: &Repo, reference: DiffRef<'_>) -> Result<Diff> {
    diff::read(repo, reference, ReadOptions::DEFAULT).await
}

pub(super) struct Polling {
    pub(super) limit: Duration,
    pub(super) period: Duration,
}

pub(super) async fn poll_until(
    polling: Polling,
    mut finished: impl FnMut() -> bool,
    mut nudge: impl FnMut(),
) {
    tokio::time::timeout(polling.limit, async {
        let mut interval = tokio::time::interval(polling.period);
        while !finished() {
            interval.tick().await;
            nudge();
        }
    })
    .await
    .unwrap();
}

pub(super) async fn confirm_quiet(polling: Polling, mut observed: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + polling.limit;
    let mut interval = tokio::time::interval(polling.period);
    loop {
        assert!(!observed(), "unexpected event arrived during quiet window");
        if tokio::time::Instant::now() >= deadline {
            return;
        }
        interval.tick().await;
    }
}

pub(super) fn no_nudge() {}

pub(super) async fn arrives<T: PartialEq>(
    seen: &Arc<Mutex<Vec<T>>>,
    expected: &T,
    nudge: impl FnMut(),
) {
    poll_until(
        Polling {
            limit: Duration::from_secs(4),
            period: Duration::from_millis(100),
        },
        || seen.lock().unwrap().contains(expected),
        nudge,
    )
    .await;
}

fn is_top_level_trace(line: &str) -> bool {
    line.split("\"sid\":\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .is_some_and(|sid| !sid.contains('/'))
}

pub(super) fn starts(trace: &Path, from: usize) -> usize {
    std::fs::read_to_string(trace).unwrap_or_default()[from..]
        .lines()
        .filter(|line| line.contains("\"event\":\"start\"") && is_top_level_trace(line))
        .count()
}

pub(super) fn exits(trace: &Path, from: usize) -> usize {
    std::fs::read_to_string(trace).unwrap_or_default()[from..]
        .lines()
        .filter(|line| line.contains("\"event\":\"exit\"") && is_top_level_trace(line))
        .count()
}

pub(super) fn launched(trace: &Path, from: usize, name: &str) -> usize {
    let wanted = format!("\"name\":\"{name}\"");
    std::fs::read_to_string(trace).unwrap_or_default()[from..]
        .lines()
        .filter(|line| {
            line.contains("\"event\":\"cmd_name\"")
                && line.contains(&wanted)
                && is_top_level_trace(line)
        })
        .count()
}

pub(super) fn trace_size(trace: &Path) -> usize {
    std::fs::metadata(trace).map_or(0, |meta| usize::try_from(meta.len()).unwrap())
}

pub(super) fn trace_file(dir: &TempDir, name: &str) -> PathBuf {
    dir.path().join("..").join(format!(
        "{}-{name}.json",
        dir.path().file_name().unwrap().to_string_lossy()
    ))
}

pub(super) async fn counted<F: std::future::Future>(trace: &Path, work: F) -> usize {
    let from = trace_size(trace);
    work.await;
    starts(trace, from)
}
