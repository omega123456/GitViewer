use super::support::{
    arrives, base, command, confirm_quiet, counted, exits, fixture, launched, no_nudge, poll_until,
    read_diff, record, silent, trace_file, trace_size, Polling, Recorded,
};
use gitviewer_lib::{
    actions::{self, FilesAction},
    ai,
    branch::{self, SyncAction},
    diff::{
        self, stack::StackRef, DiffRef, DiffSource, Endpoints, HunkRequest, LineKind, ReadOptions,
        Side,
    },
    git, history,
    repo::{Registry, Repo, Repository},
    stash, tree,
    watch::{self, Change},
};
use notify::{Event, EventKind};
use notify_debouncer_full::DebouncedEvent;
use serde_json::json;
use std::time::{Duration, Instant};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tempfile::TempDir;
use wiremock::{
    matchers::{body_partial_json, method, path},
    Mock, MockServer, ResponseTemplate,
};

struct FileText {
    source: DiffSource,
    revision: String,
    base: String,
    side: Side,
}
async fn file_text(repo: &Repo, request: FileText) -> Option<String> {
    diff::text(
        repo,
        DiffRef {
            path: "file.txt",
            source: request.source,
            revision: &request.revision,
            base: &request.base,
        },
        request.side,
    )
    .await
    .unwrap()
}
fn working_stack(source: DiffSource) -> StackRef<'static> {
    StackRef {
        source,
        revision: "",
        base: "",
    }
}
fn commit_stack(revision: &str) -> StackRef<'_> {
    StackRef {
        source: DiffSource::Commit,
        revision,
        base: "",
    }
}
fn stash_stack(revision: &str) -> StackRef<'_> {
    StackRef {
        source: DiffSource::Stash,
        revision,
        base: "",
    }
}
fn compare_stack<'a>(revision: &'a str, base: &'a str) -> StackRef<'a> {
    StackRef {
        source: DiffSource::Compare,
        revision,
        base,
    }
}
async fn read_stack(repo: &Repo, source: DiffSource) -> diff::stack::Stack {
    diff::stack::read(repo, working_stack(source))
        .await
        .unwrap()
}
async fn record_on_new_branch(repo: &Repo, name: &str, change: Recorded<'_>) {
    branch::create(repo, name, "HEAD").await.unwrap();
    branch::switch(repo, name).await.unwrap();
    record(repo, change).await;
    branch::switch(repo, "main").await.unwrap();
}
fn plain_apply(pop: bool) -> stash::ApplyOptions {
    stash::ApplyOptions { pop, smart: false }
}
fn touch_in_future(path: &Path) {
    let later: std::time::SystemTime = (chrono::Utc::now() + chrono::Duration::seconds(30)).into();
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(later)
        .unwrap();
}
fn write_empty_files(folder: &std::path::Path, count: usize) {
    for file in 0..count {
        std::fs::write(folder.join(format!("{file}.txt")), "").unwrap();
    }
}
fn write_numbered_files(root: &std::path::Path, count: usize) {
    for number in 0..count {
        std::fs::write(
            root.join(format!("f{count}-{number}.txt")),
            format!("{number}\n"),
        )
        .unwrap();
    }
}
fn index_after<'a>(action: &str, changed: &'a str, original: &'a str) -> &'a str {
    if action == "stage" {
        return changed;
    }
    original
}
async fn apply_first_hunk(repo: &Repo, source: DiffSource, action: &str) {
    let diff = read_diff(repo, DiffRef::working("file.txt", source))
        .await
        .unwrap();
    let patch = diff::patch("file.txt", &diff.hunks[0]).unwrap();
    diff::apply_hunk(
        repo,
        HunkRequest {
            path: "file.txt",
            source,
            hunk: 0,
            expected: &patch,
            action,
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn lazy_tree_and_plain_reads_respect_gitignore() {
    let (dir, repo) = fixture().await;
    assert!(history::page(&repo, "", "")
        .await
        .unwrap()
        .commits
        .is_empty());
    assert!(actions::commit(&repo, "").await.is_err());
    assert!(actions::commit(&repo, "empty").await.is_err());
    std::fs::create_dir(dir.path().join("ignored")).unwrap();
    std::fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
    std::fs::write(dir.path().join("ignored/secret"), "local").unwrap();
    std::fs::write(dir.path().join("file name\t.txt"), "hello\n").unwrap();
    repo.refresh().await.unwrap();
    let files = tree::list(&repo, "").await.unwrap();
    assert_eq!(files.len(), 3);
    assert!(files[0].directory);
    assert!(files[0].ignored);
    assert_eq!(tree::list(&repo, "ignored").await.unwrap().len(), 1);
    let all = tree::files(&repo, false).await.unwrap();
    assert!(all.contains(&".gitignore".to_string()));
    assert!(all.contains(&"file name\t.txt".to_string()));
    assert!(!all.iter().any(|path| path.starts_with("ignored")));
    let with_ignored = tree::files(&repo, true).await.unwrap();
    assert!(with_ignored.contains(&"ignored/secret".to_string()));
    let plain = read_diff(&repo, DiffRef::working("ignored/secret", DiffSource::File))
        .await
        .unwrap();
    assert_eq!(plain.content.as_deref(), Some("local"));
    assert!(!plain.added);
}

#[tokio::test]
async fn staging_commit_and_invalid_path_guards() {
    let (dir, repo) = fixture().await;
    std::fs::create_dir(dir.path().join("ignored")).unwrap();
    std::fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
    std::fs::write(dir.path().join("ignored/secret"), "local").unwrap();
    std::fs::write(dir.path().join("file name\t.txt"), "hello\n").unwrap();
    repo.refresh().await.unwrap();
    actions::files(&repo, &["file name\t.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::files(&repo, &["file name\t.txt".into()], FilesAction::Unstage)
        .await
        .unwrap();
    actions::files(
        &repo,
        &["file name\t.txt".into(), ".gitignore".into()],
        FilesAction::Stage,
    )
    .await
    .unwrap();
    let oid = actions::commit(&repo, "first").await.unwrap();
    assert_eq!(repo.refresh().await.unwrap().oid, oid);
    assert_eq!(
        history::page(&repo, "", "").await.unwrap().commits[0].subject,
        "first"
    );
    assert!(actions::files(&repo, &[], FilesAction::Stage)
        .await
        .is_err());
    assert!(
        actions::files(&repo, &["../outside".into()], FilesAction::Stage)
            .await
            .is_err()
    );
    assert!(
        actions::files(&repo, &[".git/config".into()], FilesAction::Discard)
            .await
            .is_err()
    );
    assert!(repo.path("/absolute").is_err());
    assert!(
        actions::files(&repo, &["ignored/secret".into()], FilesAction::Stage)
            .await
            .is_err()
    );
}
#[tokio::test]
async fn hunk_stage_unstage_discard_and_staleness() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    std::fs::write(dir.path().join("file.txt"), "one\nchanged\nthree").unwrap();
    repo.refresh().await.unwrap();
    let unstaged = read_diff(&repo, DiffRef::working("file.txt", DiffSource::Unstaged))
        .await
        .unwrap();
    assert!(unstaged.hunks[0].lines.last().unwrap().no_newline);
    assert!(diff::apply_hunk(
        &repo,
        HunkRequest {
            path: "file.txt",
            source: DiffSource::Unstaged,
            hunk: 0,
            expected: "outdated",
            action: "stage",
        }
    )
    .await
    .is_err());
    apply_first_hunk(&repo, DiffSource::Unstaged, "stage").await;
    repo.refresh().await.unwrap();
    apply_first_hunk(&repo, DiffSource::Staged, "unstage").await;
    apply_first_hunk(&repo, DiffSource::Unstaged, "discard").await;
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "one\ntwo\nthree\n"
    );
    assert!(diff::apply_hunk(
        &repo,
        HunkRequest {
            path: "file.txt",
            source: DiffSource::Commit,
            hunk: 0,
            expected: "",
            action: "stage",
        }
    )
    .await
    .is_err());
}
#[tokio::test]
async fn commit_detail_carries_the_full_message() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    let initial = history::detail(&repo, "HEAD").await.unwrap();
    assert_eq!(initial.subject, "Initial");
    assert_eq!(initial.body, "");
    std::fs::write(dir.path().join("file.txt"), "changed\n").unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(
        &repo,
        "Explain the change\n\nFirst reason.\n\n- Second reason\n",
    )
    .await
    .unwrap();
    let detail = history::detail(&repo, "HEAD").await.unwrap();
    assert_eq!(detail.hash.len(), 40);
    assert_eq!(detail.author, "Fixture Author");
    assert!(detail.timestamp > 0);
    assert_eq!(detail.subject, "Explain the change");
    assert_eq!(detail.body, "First reason.\n\n- Second reason");
    assert!(history::detail(&repo, "missing").await.is_err());
}
#[tokio::test]
async fn checkout_rollback_and_stash_apply_pop_restore() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    record_on_new_branch(
        &repo,
        "other",
        Recorded {
            path: "file.txt",
            body: "branch version\n",
            message: "other commit",
        },
    )
    .await;
    std::fs::write(dir.path().join("file.txt"), "local version\n").unwrap();
    let before = repo.refresh().await.unwrap();
    assert!(branch::switch(&repo, "other").await.is_err());
    assert!(stash::smart_checkout(&repo, "other").await.is_err());
    let after = repo.refresh().await.unwrap();
    assert_eq!(after.branch, "main");
    assert_eq!(before.entries, after.entries);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "local version\n"
    );
    assert!(stash::list(&repo).await.unwrap().is_empty());
    let sha = stash::save(&repo, "local experiment").await.unwrap();
    branch::switch(&repo, "other").await.unwrap();
    stash::apply(&repo, &sha, plain_apply(false)).await.unwrap();
    assert!(repo.refresh().await.unwrap().conflicted);
    command(dir.path(), &["reset", "--hard", "HEAD"]).await;
    assert_eq!(stash::list(&repo).await.unwrap().len(), 1);
    branch::switch(&repo, "main").await.unwrap();
    stash::apply(&repo, &sha, plain_apply(true)).await.unwrap();
    assert!(stash::list(&repo).await.unwrap().is_empty());
    assert!(stash::store(&repo, "missing", "lost").await.is_err());
    stash::store(&repo, &sha, "On main: local experiment")
        .await
        .unwrap();
    let restored = stash::list(&repo).await.unwrap();
    assert_eq!(restored[0].hash, sha);
    assert_eq!(restored[0].message, "On main: local experiment");
    stash::remove(&repo, &sha).await.unwrap();
}
#[tokio::test]
async fn blame_history_and_branch_deletion() {
    let (_dir, repo) = fixture().await;
    base(&repo).await;
    branch::create(&repo, "other", "HEAD").await.unwrap();
    let blamed = history::blame(&repo, "file.txt").await.unwrap();
    assert_eq!(blamed.len(), 3);
    assert!(blamed.iter().all(|line| line.subject == "Initial"));
    assert!(history::blame(&repo, "untracked").await.unwrap().is_empty());
    let commits = history::page(&repo, "", "file.txt").await.unwrap();
    assert_eq!(
        history::files(&repo, &commits.commits[0].hash)
            .await
            .unwrap()
            .statuses
            .into_iter()
            .collect::<Vec<_>>(),
        vec![("file.txt".to_owned(), "A".to_owned())]
    );
    let commit_diff = read_diff(
        &repo,
        DiffRef {
            path: "file.txt",
            source: DiffSource::Commit,
            revision: &commits.commits[0].hash,
            base: "",
        },
    )
    .await
    .unwrap();
    assert!(!commit_diff.hunks.is_empty());
    branch::create(&repo, "temporary", "HEAD").await.unwrap();
    branch::delete(&repo, "temporary").await.unwrap();
    branch::delete(&repo, "other").await.unwrap();
    assert!(!branch::list(&repo)
        .await
        .unwrap()
        .iter()
        .any(|branch| branch.name == "other"));
    assert!(branch::switch(&repo, "missing").await.is_err());
}
async fn assert_direct_compare_read(repo: &Repo, base: &str, target: &str) {
    let read = read_diff(
        repo,
        DiffRef {
            path: "file.txt",
            source: DiffSource::Compare,
            revision: target,
            base,
        },
    )
    .await
    .unwrap();
    assert_eq!(read.hunks.len(), 1);
    assert_eq!(read.hunks[0].lines[3].kind, LineKind::Remove);
    assert_eq!(read.hunks[0].lines[3].content, "four");
    assert_eq!(read.old_size, 19);
    assert_eq!(read.new_size, 14);
}
#[tokio::test]
async fn branch_comparison_supports_merge_base_and_direct_diffs() {
    let (_dir, repo) = fixture().await;
    base(&repo).await;
    record_on_new_branch(
        &repo,
        "feature",
        Recorded {
            path: "feature.txt",
            body: "feature\n",
            message: "feature commit",
        },
    )
    .await;
    record(
        &repo,
        Recorded {
            path: "file.txt",
            body: "one\ntwo\nthree\nfour\n",
            message: "main commit",
        },
    )
    .await;
    let endpoints = Endpoints {
        base: "main",
        target: "feature",
    };
    let since_divergence = diff::compare(&repo, endpoints, true).await.unwrap();
    assert_eq!(since_divergence.files.len(), 1);
    assert_eq!(since_divergence.files[0].path, "feature.txt");
    assert_eq!(since_divergence.files[0].status, "A");
    assert_eq!(since_divergence.files[0].additions, 1);
    assert_eq!(since_divergence.files[0].deletions, 0);
    assert_eq!(since_divergence.base.len(), 40);
    assert_eq!(
        since_divergence.target,
        diff::resolve(&repo, "feature").await.unwrap()
    );
    let direct = diff::compare(&repo, endpoints, false).await.unwrap();
    let listed: Vec<(&str, &str, u32, u32)> = direct
        .files
        .iter()
        .map(|file| {
            (
                file.path.as_str(),
                file.status.as_str(),
                file.additions,
                file.deletions,
            )
        })
        .collect();
    assert_eq!(
        listed,
        vec![("feature.txt", "A", 1, 0), ("file.txt", "M", 0, 1)]
    );
    assert_eq!(direct.base, diff::resolve(&repo, "main").await.unwrap());
    assert_direct_compare_read(&repo, &direct.base, &direct.target).await;
}
#[tokio::test]
async fn branch_comparison_refuses_unrelated_merge_bases() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    assert!(diff::compare(
        &repo,
        Endpoints {
            base: "main",
            target: "main",
        },
        true,
    )
    .await
    .unwrap()
    .files
    .is_empty());
    assert!(diff::compare(
        &repo,
        Endpoints {
            base: "main",
            target: "missing",
        },
        true,
    )
    .await
    .is_err());
    command(dir.path(), &["checkout", "--orphan", "island"]).await;
    std::fs::write(dir.path().join("island.txt"), "island\n").unwrap();
    command(dir.path(), &["add", "island.txt"]).await;
    command(dir.path(), &["commit", "-m", "island"]).await;
    repo.refresh().await.unwrap();
    let endpoints = Endpoints {
        base: "main",
        target: "island",
    };
    let refused = diff::compare(&repo, endpoints, true).await.unwrap_err();
    assert_eq!(refused.category, "refused");
    assert!(refused.message.contains("no common commit"));
    let unrelated = diff::compare(&repo, endpoints, false).await.unwrap();
    assert_eq!(unrelated.files.len(), 1);
    assert_eq!(unrelated.files[0].path, "island.txt");
}
#[tokio::test]
async fn default_branch_follows_remote_head_and_local_fallbacks() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    assert_eq!(branch::default_branch(&repo).await.unwrap(), "main");
    command(dir.path(), &["checkout", "--orphan", "island"]).await;
    std::fs::write(dir.path().join("island.txt"), "island\n").unwrap();
    command(dir.path(), &["add", "island.txt"]).await;
    command(dir.path(), &["commit", "-m", "island"]).await;
    repo.refresh().await.unwrap();
    command(
        dir.path(),
        &["update-ref", "refs/remotes/origin/develop", "HEAD"],
    )
    .await;
    command(
        dir.path(),
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/develop",
        ],
    )
    .await;
    assert_eq!(
        branch::default_branch(&repo).await.unwrap(),
        "origin/develop"
    );
    command(dir.path(), &["branch", "develop", "HEAD"]).await;
    assert_eq!(branch::default_branch(&repo).await.unwrap(), "develop");
    command(
        dir.path(),
        &["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"],
    )
    .await;
    command(dir.path(), &["branch", "-m", "main", "master"]).await;
    assert_eq!(branch::default_branch(&repo).await.unwrap(), "master");
    command(dir.path(), &["branch", "-D", "master"]).await;
    assert_eq!(branch::default_branch(&repo).await.unwrap(), "island");
}
#[tokio::test]
async fn smart_apply_combines_disjoint_work_and_hashes_survive_renumbering() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    std::fs::write(dir.path().join("file.txt"), "stashed\n").unwrap();
    let target = stash::save(&repo, "target").await.unwrap();
    std::fs::write(dir.path().join("new.txt"), "new untracked\n").unwrap();
    stash::apply(
        &repo,
        &target,
        stash::ApplyOptions {
            pop: true,
            smart: true,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "stashed\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("new.txt")).unwrap(),
        "new untracked\n"
    );
    assert!(stash::list(&repo).await.unwrap().is_empty());
    let target = stash::save(&repo, "target").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "overlap\n").unwrap();
    assert!(stash::apply(
        &repo,
        &target,
        stash::ApplyOptions {
            pop: false,
            smart: true
        }
    )
    .await
    .unwrap_err()
    .message
    .contains("share paths"));
}
#[tokio::test]
async fn watcher_invalidates_without_mutating_status() {
    let (dir, handle) = fixture().await;
    let hits = Arc::new(AtomicUsize::new(0));
    let captured = hits.clone();
    watch::start(&handle, move |_| {
        captured.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();
    std::fs::write(dir.path().join("new.txt"), "new").unwrap();
    poll_until(
        Polling {
            limit: Duration::from_secs(4),
            period: Duration::from_millis(500),
        },
        || hits.load(Ordering::SeqCst) != 0,
        || std::fs::write(dir.path().join("new.txt"), "new").unwrap(),
    )
    .await;
    let repo = handle.clone();
    assert_eq!(repo.snapshot().await.unwrap().entries.len(), 1);
}
fn classify(root: &Path, paths: &[PathBuf]) -> bool {
    let event = paths
        .iter()
        .fold(Event::new(EventKind::Any), |event, path| {
            event.add_path(path.clone())
        });
    let events: Vec<DebouncedEvent> = (!paths.is_empty())
        .then(|| DebouncedEvent::new(event, Instant::now()))
        .into_iter()
        .collect();
    std::thread::scope(|scope| {
        scope
            .spawn(|| watch::ignored_only(root, &events))
            .join()
            .unwrap()
    })
}
#[tokio::test]
async fn ignored_only_batches_refresh_file_listings_without_a_status_read() {
    let (dir, handle) = fixture().await;
    std::fs::write(dir.path().join(".gitignore"), "node_modules/\n").unwrap();
    std::fs::create_dir(dir.path().join("node_modules")).unwrap();
    std::fs::create_dir(dir.path().join("src")).unwrap();
    let root = handle.root.clone();
    let ignored = root.join("node_modules").join("a.js");
    let deleted = root.join("node_modules").join("gone").join("b.js");
    let tracked = root.join("src").join("main.rs");
    assert_eq!(
        git::ignored(&root, ["node_modules/a.js", "src/main.rs"])
            .await
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>(),
        vec!["node_modules/a.js".to_owned()]
    );
    assert!(classify(&root, &[ignored.clone(), deleted]));
    assert!(!classify(&root, &[ignored.clone(), tracked]));
    assert!(!classify(&root, &[root.join(".git").join("index")]));
    assert!(!classify(&root, std::slice::from_ref(&root)));
    assert!(!classify(&root, &[dir.path().join("..").join("elsewhere")]));
    assert!(!classify(&root, &[]));
    handle.snapshot().await.unwrap();
    let changes = Arc::new(Mutex::new(Vec::new()));
    let captured = changes.clone();
    watch::start(&handle, move |change| captured.lock().unwrap().push(change)).unwrap();
    watch::start(&handle, |_| panic!("a second watcher must not start")).unwrap();
    poll_until(
        Polling {
            limit: Duration::from_secs(4),
            period: Duration::from_millis(500),
        },
        || changes.lock().unwrap().contains(&Change::Files),
        || std::fs::write(&ignored, "generated").unwrap(),
    )
    .await;
    assert!(!handle.stale.load(Ordering::SeqCst));
}
#[tokio::test]
async fn working_tree_reads_never_rewrite_the_index() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    record(
        &repo,
        Recorded {
            path: "changed.txt",
            body: "before\n",
            message: "Add changed",
        },
    )
    .await;
    std::fs::write(dir.path().join("changed.txt"), "after\n").unwrap();
    touch_in_future(&dir.path().join("file.txt"));
    let index = dir.path().join(".git").join("index");
    let before = std::fs::read(&index).unwrap();
    let untouched = read_diff(&repo, DiffRef::working("file.txt", DiffSource::Unstaged))
        .await
        .unwrap();
    assert!(untouched.hunks.is_empty());
    let changed = read_diff(&repo, DiffRef::working("changed.txt", DiffSource::Unstaged))
        .await
        .unwrap();
    assert_eq!(changed.hunks.len(), 1);
    equivalent(
        &repo,
        StackRef {
            source: DiffSource::Unstaged,
            revision: "",
            base: "",
        },
        &["changed.txt"],
    )
    .await;
    assert!(ai::material(&repo.root)
        .await
        .unwrap()
        .text
        .contains("+after"));
    assert_eq!(std::fs::read(&index).unwrap(), before);
    command(dir.path(), &["diff", "--", "file.txt"]).await;
    assert_ne!(std::fs::read(&index).unwrap(), before);
}

struct RemotePair {
    local_dir: TempDir,
    local: Repository,
    _peer_dir: TempDir,
    peer: Repository,
    _remote_dir: TempDir,
}

async fn setup_remote_pair() -> RemotePair {
    let (local_dir, local) = fixture().await;
    base(&local).await;
    let remote_dir = tempfile::tempdir().unwrap();
    command(
        remote_dir.path(),
        &["init", "--bare", "--initial-branch=main"],
    )
    .await;
    let remote_path = remote_dir.path().to_str().unwrap();
    command(local_dir.path(), &["remote", "add", "origin", remote_path]).await;
    command(local_dir.path(), &["push", "-u", "origin", "main"]).await;
    let (peer_dir, peer) = fixture().await;
    command(peer_dir.path(), &["remote", "add", "origin", remote_path]).await;
    command(peer_dir.path(), &["fetch", "origin"]).await;
    command(peer_dir.path(), &["checkout", "-B", "main", "origin/main"]).await;
    RemotePair {
        local_dir,
        local,
        _peer_dir: peer_dir,
        peer,
        _remote_dir: remote_dir,
    }
}

#[tokio::test]
async fn local_remote_fetch_pull_and_push_preserve_dirty_files() {
    let pair = setup_remote_pair().await;
    record(
        &pair.peer,
        Recorded {
            path: "remote.txt",
            body: "remote\n",
            message: "Remote change",
        },
    )
    .await;
    assert_eq!(
        branch::sync(&pair.peer, SyncAction::Push, silent())
            .await
            .unwrap(),
        Some(1)
    );
    let repo = &pair.local;
    let root = pair.local_dir.path();
    assert_eq!(repo.refresh().await.unwrap().fetched, None);
    let reported = Arc::new(Mutex::new(Vec::<String>::new()));
    let collector = reported.clone();
    let fetched = branch::sync(repo, SyncAction::Fetch, move |line| {
        collector.lock().unwrap().push(line.into())
    })
    .await
    .unwrap();
    assert_eq!(fetched, Some(1));
    assert!(!reported.lock().unwrap().is_empty());
    let refreshed = repo.refresh().await.unwrap();
    assert_eq!(refreshed.divergence.behind, Some(1));
    assert!(refreshed
        .fetched
        .as_deref()
        .is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok()));
    std::fs::write(root.join("file.txt"), "one\ntwo\ndirty\n").unwrap();
    std::fs::write(root.join("untracked.txt"), "untracked\n").unwrap();
    repo.refresh().await.unwrap();
    assert_eq!(
        branch::sync(repo, SyncAction::Pull, silent())
            .await
            .unwrap(),
        Some(1)
    );
    assert!(root.join("remote.txt").exists());
    assert!(root.join("untracked.txt").exists());
    assert_eq!(
        std::fs::read_to_string(root.join("file.txt")).unwrap(),
        "one\ntwo\ndirty\n"
    );
    actions::files(repo, &["file.txt".into()], FilesAction::Discard)
        .await
        .unwrap();
    std::fs::remove_file(root.join("untracked.txt")).unwrap();
    repo.refresh().await.unwrap();
    branch::sync(repo, SyncAction::Push, silent())
        .await
        .unwrap();
    branch::create(repo, "merged", "HEAD").await.unwrap();
    command(root, &["push", "origin", "merged"]).await;
    branch::delete(repo, "origin/merged").await.unwrap();
}

#[tokio::test]
async fn diverged_pull_detached_push_and_non_local_remotes_are_refused() {
    let pair = setup_remote_pair().await;
    let repo = &pair.local;
    let root = pair.local_dir.path();
    record(
        repo,
        Recorded {
            path: "local.txt",
            body: "local\n",
            message: "Local change",
        },
    )
    .await;
    record(
        &pair.peer,
        Recorded {
            path: "another.txt",
            body: "another\n",
            message: "Divergence",
        },
    )
    .await;
    branch::sync(&pair.peer, SyncAction::Push, silent())
        .await
        .unwrap();
    let diverged = branch::sync(repo, SyncAction::Pull, silent())
        .await
        .unwrap_err();
    assert_eq!(diverged.category, "diverged");
    assert_eq!(diverged.message, "main and origin/main have diverged");
    assert!(repo.refresh().await.unwrap().entries.is_empty());
    assert_eq!(
        SyncAction::parse("invalid").unwrap_err().message,
        "Unknown synchronization action"
    );
    command(root, &["checkout", "--detach"]).await;
    assert!(branch::sync(repo, SyncAction::Push, silent())
        .await
        .unwrap_err()
        .message
        .contains("Detached"));
    command(
        root,
        &[
            "remote",
            "set-url",
            "origin",
            "https://example.invalid/no-network-test",
        ],
    )
    .await;
    assert!(branch::sync(repo, SyncAction::Fetch, silent())
        .await
        .unwrap_err()
        .message
        .contains("fixture remotes"));
}

#[tokio::test]
async fn last_fetch_is_the_newest_fetch_head_across_worktrees() {
    let (dir, repo) = fixture().await;
    let main = dir.path().join(".git/FETCH_HEAD");
    std::fs::write(&main, "").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&main)
        .unwrap()
        .set_modified((chrono::Utc::now() - chrono::Duration::days(1)).into())
        .unwrap();
    let linked = dir.path().join(".git/worktrees/linked");
    std::fs::create_dir_all(&linked).unwrap();
    std::fs::write(linked.join("FETCH_HEAD"), "").unwrap();
    let newest = chrono::DateTime::<chrono::Utc>::from(
        std::fs::metadata(linked.join("FETCH_HEAD"))
            .unwrap()
            .modified()
            .unwrap(),
    );
    assert_eq!(
        repo.refresh().await.unwrap().fetched,
        Some(newest.to_rfc3339())
    );
}
#[tokio::test]
async fn push_publishes_a_branch_without_upstream() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    command(dir.path(), &["checkout", "-b", "feature"]).await;
    assert!(branch::sync(&handle, SyncAction::Push, silent())
        .await
        .unwrap_err()
        .message
        .contains("Add a remote"));
    let remote = tempfile::tempdir().unwrap();
    command(remote.path(), &["init", "--bare", "--initial-branch=main"]).await;
    command(
        dir.path(),
        &["remote", "add", "upstream", remote.path().to_str().unwrap()],
    )
    .await;
    handle.refresh().await.unwrap();
    assert_eq!(
        branch::sync(&handle, SyncAction::Push, silent())
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        handle.refresh().await.unwrap().upstream.as_deref(),
        Some("upstream/feature")
    );
    command(remote.path(), &["rev-parse", "--verify", "feature"]).await;
}

async fn append_commit_chain(root: &Path, count: usize, prefix: &str) -> String {
    let tree = command(root, &["rev-parse", "HEAD^{tree}"]).await;
    let mut parent = command(root, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_string();
    for index in 0..count {
        parent = git::run(
            root,
            &["commit-tree", tree.trim(), "-p", &parent],
            Some(format!("{prefix} {index}\n").as_bytes()),
        )
        .await
        .unwrap()
        .accept(&[0])
        .unwrap()
        .text()
        .trim()
        .into();
    }
    command(root, &["update-ref", "refs/heads/main", &parent]).await;
    parent
}

#[tokio::test]
async fn history_cursor_preserves_merge_frontier_and_cached_pages() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    command(dir.path(), &["branch", "side"]).await;
    let tree = command(dir.path(), &["rev-parse", "HEAD^{tree}"]).await;
    let parent = append_commit_chain(dir.path(), 110, "main").await;
    let side = command(dir.path(), &["rev-parse", "side"]).await;
    let side = git::run(
        dir.path(),
        &["commit-tree", tree.trim(), "-p", side.trim()],
        Some(b"side commit\n"),
    )
    .await
    .unwrap()
    .accept(&[0])
    .unwrap()
    .text();
    let merge = git::run(
        dir.path(),
        &["commit-tree", tree.trim(), "-p", &parent, "-p", side.trim()],
        Some(b"merge\n"),
    )
    .await
    .unwrap()
    .accept(&[0])
    .unwrap()
    .text();
    command(dir.path(), &["update-ref", "refs/heads/main", merge.trim()]).await;
    let expected = command(dir.path(), &["rev-list", "--date-order", "HEAD"]).await;
    repo.refresh().await.unwrap();
    let first = history::page(&repo, "", "").await.unwrap();
    assert_eq!(first.commits.len(), 100);
    std::fs::write(dir.path().join("untracked.txt"), "local edit").unwrap();
    repo.stale.store(true, Ordering::SeqCst);
    repo.snapshot().await.unwrap();
    assert!(!repo.histories.lock().await.is_empty());
    let second = history::page(&repo, first.cursor.as_deref().unwrap(), "")
        .await
        .unwrap();
    let hashes: Vec<&str> = first
        .commits
        .iter()
        .chain(&second.commits)
        .map(|commit| commit.hash.as_str())
        .collect();
    assert_eq!(hashes, expected.lines().collect::<Vec<_>>());
    assert_eq!(
        history::page(&repo, "", "").await.unwrap().commits[0].hash,
        first.commits[0].hash
    );
    assert!(history::page(&repo, "invalid", "").await.is_err());
    assert!(history::page(&repo, "expired", "file.txt").await.is_err());
}

#[tokio::test]
async fn file_limits_binary_and_missing_diff_guards() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    std::fs::write(dir.path().join("binary.bin"), b"a\0b").unwrap();
    assert!(
        read_diff(&repo, DiffRef::working("binary.bin", DiffSource::File))
            .await
            .unwrap()
            .binary
    );
    std::fs::write(
        dir.path().join("large.txt"),
        vec![b'x'; 2 * 1024 * 1024 + 1],
    )
    .unwrap();
    assert!(
        read_diff(&repo, DiffRef::working("large.txt", DiffSource::File))
            .await
            .unwrap()
            .too_large
    );
    assert!(
        !diff::read(
            &repo,
            DiffRef::working("large.txt", DiffSource::File),
            ReadOptions::UNLIMITED,
        )
        .await
        .unwrap()
        .too_large
    );
    assert_eq!(
        read_diff(&repo, DiffRef::working("missing", DiffSource::File))
            .await
            .unwrap()
            .content
            .as_deref(),
        Some("")
    );
    assert_eq!(
        DiffSource::parse("invalid").unwrap_err().message,
        "Unknown diff source"
    );
    assert!(diff::resolve(&repo, "not-a-revision").await.is_err());
}

#[tokio::test]
async fn tree_action_stash_and_branch_refuse_invalid_inputs() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    std::fs::write(dir.path().join("binary.bin"), b"a\0b").unwrap();
    assert!(tree::list(&repo, "missing").await.is_err());
    std::fs::create_dir(dir.path().join("empty")).unwrap();
    assert!(tree::list(&repo, "empty").await.unwrap().is_empty());
    assert!(
        actions::files(&repo, &["binary.bin".into()], FilesAction::Discard)
            .await
            .is_err()
    );
    assert_eq!(
        FilesAction::parse("invalid").unwrap_err().category,
        "refused"
    );
    assert!(stash::remove(&repo, "missing").await.is_err());
    assert!(stash::apply(&repo, "missing", plain_apply(false))
        .await
        .is_err());
    assert!(branch::delete(&repo, "main").await.is_err());
    assert!(branch::delete(&repo, "missing").await.is_err());
}

#[tokio::test]
async fn rename_hunks_preserve_identity_and_file_unstage_restores_both_paths() {
    let (dir, repo) = fixture().await;
    let content = (0..80)
        .map(|line| format!("line {line}\n"))
        .collect::<String>();
    std::fs::write(dir.path().join("original.txt"), &content).unwrap();
    actions::files(&repo, &["original.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "Original").await.unwrap();
    command(dir.path(), &["mv", "original.txt", "renamed.txt"]).await;
    let changed = content.replace("line 20\n", "changed 20\n");
    std::fs::write(dir.path().join("renamed.txt"), &changed).unwrap();
    actions::files(&repo, &["renamed.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    repo.refresh().await.unwrap();
    let staged = read_diff(&repo, DiffRef::working("renamed.txt", DiffSource::Staged))
        .await
        .unwrap();
    assert_eq!(staged.hunks.len(), 1);
    let patch = diff::patch("renamed.txt", &staged.hunks[0]).unwrap();
    diff::apply_hunk(
        &repo,
        HunkRequest {
            path: "renamed.txt",
            source: DiffSource::Staged,
            hunk: 0,
            expected: &patch,
            action: "unstage",
        },
    )
    .await
    .unwrap();
    let status = repo.refresh().await.unwrap();
    assert_eq!(status.entries[0].index(), "R");
    assert_eq!(status.entries[0].worktree(), "M");
    assert_eq!(
        diff::bytes(
            &repo,
            DiffRef::working("renamed.txt", DiffSource::Unstaged),
            Side::Old
        )
        .await
        .unwrap(),
        content.as_bytes()
    );
    actions::files(&repo, &["renamed.txt".into()], FilesAction::Unstage)
        .await
        .unwrap();
    assert!(command(dir.path(), &["diff", "--cached", "--name-only"])
        .await
        .is_empty());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("renamed.txt")).unwrap(),
        changed
    );
}

#[tokio::test]
async fn one_of_three_hunks_and_new_file_hunks_match_the_index() {
    let (dir, repo) = fixture().await;
    let original = (0..100)
        .map(|line| format!("line {line}\n"))
        .collect::<String>();
    std::fs::write(dir.path().join("file.txt"), &original).unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "Base").await.unwrap();
    let changed = original
        .replace("line 10\n", "ten\n")
        .replace("line 50\n", "fifty\n")
        .replace("line 90\n", "ninety\n");
    std::fs::write(dir.path().join("file.txt"), &changed).unwrap();
    let result = read_diff(&repo, DiffRef::working("file.txt", DiffSource::Unstaged))
        .await
        .unwrap();
    assert_eq!(result.hunks.len(), 3);
    let patch = diff::patch("file.txt", &result.hunks[1]).unwrap();
    diff::apply_hunk(
        &repo,
        HunkRequest {
            path: "file.txt",
            source: DiffSource::Unstaged,
            hunk: 1,
            expected: &patch,
            action: "stage",
        },
    )
    .await
    .unwrap();
    assert_eq!(
        command(dir.path(), &["show", ":file.txt"]).await,
        original.replace("line 50\n", "fifty\n")
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        changed
    );
    assert!(diff::apply_hunk(
        &repo,
        HunkRequest {
            path: "file.txt",
            source: DiffSource::Unstaged,
            hunk: 99,
            expected: "",
            action: "stage",
        }
    )
    .await
    .is_err());
}

async fn save_mixed_stash(repo: &Repo) -> String {
    std::fs::write(repo.root.join("new.txt"), "untracked content").unwrap();
    std::fs::write(repo.root.join("file.txt"), "staged content\n").unwrap();
    actions::files(repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    stash::save(repo, "With untracked").await.unwrap()
}

async fn assert_mixed_stash_diffs(repo: &Repo, hash: &str) {
    let untracked = read_diff(
        repo,
        DiffRef {
            path: "new.txt",
            source: DiffSource::Stash,
            revision: hash,
            base: "",
        },
    )
    .await
    .unwrap();
    assert_eq!(untracked.content.as_deref(), Some("untracked content"));
    assert!(untracked.added);
    let tracked = read_diff(
        repo,
        DiffRef {
            path: "file.txt",
            source: DiffSource::Stash,
            revision: hash,
            base: "",
        },
    )
    .await
    .unwrap();
    assert_eq!(tracked.hunks.len(), 1);
}

#[tokio::test]
async fn stash_untracked_contents_and_safe_checkout_preserve_staged_work() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    branch::create(&repo, "other", "HEAD").await.unwrap();
    let hash = save_mixed_stash(&repo).await;
    assert_mixed_stash_diffs(&repo, &hash).await;
    std::fs::write(dir.path().join("new.txt"), "existing content").unwrap();
    assert!(stash::precheck(&repo, &hash)
        .await
        .unwrap_err()
        .message
        .contains("untracked path"));
    std::fs::remove_file(dir.path().join("new.txt")).unwrap();
    stash::apply(&repo, &hash, plain_apply(true)).await.unwrap();
    stash::smart_checkout(&repo, "other").await.unwrap();
    assert_eq!(repo.refresh().await.unwrap().branch, "other");
    assert_eq!(
        command(dir.path(), &["show", ":file.txt"]).await,
        "staged content\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("new.txt")).unwrap(),
        "untracked content"
    );
    assert!(stash::list(&repo).await.unwrap().is_empty());
    let hash = stash::save(&repo, "Again").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "dirty").unwrap();
    assert_eq!(
        stash::apply(&repo, &hash, plain_apply(false))
            .await
            .unwrap_err()
            .category,
        "smart_apply"
    );
}

#[tokio::test]
async fn merge_previews_fast_forward_up_to_date_and_commit_outcomes() {
    let (_dir, repo) = fixture().await;
    base(&repo).await;
    assert!(branch::merge_preview(&repo, "missing").await.is_err());
    assert!(branch::merge_preview(&repo, "main").await.is_err());
    branch::create(&repo, "ahead", "HEAD").await.unwrap();
    branch::switch(&repo, "ahead").await.unwrap();
    record(
        &repo,
        Recorded {
            path: "second.txt",
            body: "second\n",
            message: "Ahead",
        },
    )
    .await;
    branch::switch(&repo, "main").await.unwrap();
    repo.refresh().await.unwrap();
    let preview = branch::merge_preview(&repo, "ahead").await.unwrap();
    assert_eq!(preview.outcome, "fastForward");
    assert_eq!(preview.changed, 1);
    assert!(preview.conflicts.is_empty());
    assert!(branch::merge(&repo, "ahead").await.unwrap());
    assert!(!repo.refresh().await.unwrap().conflicted);
    assert_eq!(
        branch::merge_preview(&repo, "ahead").await.unwrap().outcome,
        "upToDate"
    );
    branch::create(&repo, "side", "HEAD").await.unwrap();
    branch::switch(&repo, "side").await.unwrap();
    record(
        &repo,
        Recorded {
            path: "side.txt",
            body: "side\n",
            message: "Side",
        },
    )
    .await;
    branch::switch(&repo, "main").await.unwrap();
    repo.refresh().await.unwrap();
    record(
        &repo,
        Recorded {
            path: "trunk.txt",
            body: "trunk\n",
            message: "Trunk",
        },
    )
    .await;
    assert_eq!(
        branch::merge_preview(&repo, "side").await.unwrap().outcome,
        "commit"
    );
    branch::merge(&repo, "side").await.unwrap();
    assert!(!repo.refresh().await.unwrap().conflicted);
}

#[tokio::test]
async fn merge_conflicts_block_writes_until_aborted_and_refuse_invalid_states() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    record_on_new_branch(
        &repo,
        "clash",
        Recorded {
            path: "file.txt",
            body: "clash\n",
            message: "Clash",
        },
    )
    .await;
    repo.refresh().await.unwrap();
    record(
        &repo,
        Recorded {
            path: "file.txt",
            body: "trunk edit\n",
            message: "Trunk edit",
        },
    )
    .await;
    let preview = branch::merge_preview(&repo, "clash").await.unwrap();
    assert_eq!(preview.outcome, "conflict");
    assert_eq!(preview.conflicts, vec!["file.txt".to_string()]);
    assert!(branch::abort(&repo).await.is_err());
    assert!(!branch::merge(&repo, "clash").await.unwrap());
    let status = repo.refresh().await.unwrap();
    assert!(status.conflicted);
    assert_eq!(status.merging.as_deref(), Some("clash"));
    assert!(
        actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
            .await
            .is_err()
    );
    assert!(branch::merge(&repo, "clash").await.is_err());
    branch::abort(&repo).await.unwrap();
    let status = repo.refresh().await.unwrap();
    assert!(!status.conflicted);
    assert!(status.merging.is_none());
    std::fs::write(dir.path().join("file.txt"), "uncommitted\n").unwrap();
    assert!(branch::merge(&repo, "clash").await.is_err());
    command(dir.path(), &["checkout", "--", "file.txt"]).await;
    command(dir.path(), &["checkout", "--orphan", "lonely"]).await;
    record(
        &repo,
        Recorded {
            path: "lonely.txt",
            body: "lonely\n",
            message: "Lonely",
        },
    )
    .await;
    branch::switch(&repo, "main").await.unwrap();
    repo.refresh().await.unwrap();
    assert!(branch::merge_preview(&repo, "lonely").await.is_err());
    command(dir.path(), &["checkout", "--detach"]).await;
    repo.refresh().await.unwrap();
    assert!(branch::merge_preview(&repo, "clash").await.is_err());
}

#[tokio::test]
async fn conflicted_repository_refuses_writes_and_literal_paths_do_not_expand() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    branch::create(&repo, "other", "HEAD").await.unwrap();
    branch::switch(&repo, "other").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "other\n").unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "Other").await.unwrap();
    branch::switch(&repo, "main").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "main\n").unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "Main").await.unwrap();
    assert_eq!(
        git::run(dir.path(), &["merge", "other"], None)
            .await
            .unwrap()
            .code,
        1
    );
    assert!(repo.refresh().await.unwrap().conflicted);
    assert!(
        actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
            .await
            .is_err()
    );
    assert!(branch::sync(&repo, SyncAction::Fetch, silent())
        .await
        .is_err());
    assert!(stash::save(&repo, "conflict").await.is_err());
    command(dir.path(), &["merge", "--abort"]).await;
    std::fs::write(dir.path().join("[literal].txt"), "literal").unwrap();
    std::fs::write(dir.path().join("l.txt"), "other").unwrap();
    actions::files(&repo, &["[literal].txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    assert_eq!(
        command(dir.path(), &["diff", "--cached", "--name-only"])
            .await
            .trim(),
        "[literal].txt"
    );
}

#[tokio::test]
async fn fifty_thousand_files_are_read_only_when_their_directory_is_expanded() {
    let (dir, handle) = fixture().await;
    std::fs::write(dir.path().join(".gitignore"), "generated/\n").unwrap();
    std::fs::create_dir(dir.path().join("generated")).unwrap();
    for directory in 0..100 {
        let folder = dir.path().join("generated").join(directory.to_string());
        std::fs::create_dir(&folder).unwrap();
        write_empty_files(&folder, 500);
    }
    let repo = handle.clone();
    assert_eq!(repo.directory_reads.load(Ordering::SeqCst), 0);
    assert_eq!(tree::list(&repo, "").await.unwrap().len(), 2);
    assert_eq!(repo.directory_reads.load(Ordering::SeqCst), 1);
    assert_eq!(tree::list(&repo, "generated").await.unwrap().len(), 100);
    assert_eq!(tree::list(&repo, "generated/0").await.unwrap().len(), 500);
    assert_eq!(repo.directory_reads.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn invalid_repositories_upstreams_and_watch_roots_fail_honestly() {
    let directory = tempfile::tempdir().unwrap();
    assert_eq!(
        Registry::default()
            .open(directory.path().to_str().unwrap())
            .await
            .err()
            .unwrap()
            .category,
        "invalid_repository"
    );
    let (dir, repo) = fixture().await;
    base(&repo).await;
    assert!(branch::sync(&repo, SyncAction::Pull, silent())
        .await
        .unwrap_err()
        .message
        .contains("No upstream"));
    assert!(watch::start(&Arc::new(Repo::new(dir.path().join("missing"))), |_| {}).is_err());
}

struct PruneFixture {
    _dir: TempDir,
    repo: Repository,
    _remote: TempDir,
    _worktree: TempDir,
}

async fn setup_prune_fixture() -> PruneFixture {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    let remote = tempfile::tempdir().unwrap();
    command(remote.path(), &["init", "--bare", "--initial-branch=main"]).await;
    command(
        dir.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    )
    .await;
    for name in ["merged", "live", "held"] {
        command(dir.path(), &["branch", name]).await;
    }
    command(dir.path(), &["switch", "-c", "unmerged"]).await;
    record(
        &repo,
        Recorded {
            path: "unmerged.txt",
            body: "work\n",
            message: "Unmerged work",
        },
    )
    .await;
    command(dir.path(), &["switch", "main"]).await;
    command(dir.path(), &["branch", "local-only"]).await;
    command(
        dir.path(),
        &[
            "push", "-u", "origin", "main", "merged", "unmerged", "live", "held",
        ],
    )
    .await;
    let worktree = tempfile::tempdir().unwrap();
    let held = worktree.path().join("held");
    command(
        dir.path(),
        &["worktree", "add", held.to_str().unwrap(), "held"],
    )
    .await;
    command(
        remote.path(),
        &["branch", "-D", "merged", "unmerged", "held"],
    )
    .await;
    PruneFixture {
        _dir: dir,
        repo,
        _remote: remote,
        _worktree: worktree,
    }
}

#[tokio::test]
async fn prune_deletes_merged_branches_without_a_remote_branch() {
    let fixture = setup_prune_fixture().await;
    let repo = &fixture.repo;
    assert!(branch::list(repo)
        .await
        .unwrap()
        .iter()
        .all(|branch| !branch.gone));
    assert_eq!(
        branch::gone(repo).await.unwrap(),
        ["local-only", "merged", "unmerged"]
    );
    let gone: Vec<String> = branch::list(repo)
        .await
        .unwrap()
        .into_iter()
        .filter(|branch| branch.gone)
        .map(|branch| branch.name)
        .collect();
    assert_eq!(gone, ["held", "merged", "unmerged"]);
    let pruned = branch::prune(
        repo,
        ["local-only", "merged", "unmerged", "live", "missing"]
            .map(String::from)
            .to_vec(),
    )
    .await
    .unwrap();
    assert_eq!(pruned.deleted, ["local-only", "merged"]);
    assert_eq!(pruned.kept, ["unmerged"]);
    let names: Vec<String> = branch::list(repo)
        .await
        .unwrap()
        .into_iter()
        .filter(|branch| !branch.remote)
        .map(|branch| branch.name)
        .collect();
    assert_eq!(names, ["held", "live", "main", "unmerged"]);
}
#[tokio::test]
async fn remote_checkout_creates_tracking_branches_and_never_detaches() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    let remote = tempfile::tempdir().unwrap();
    command(remote.path(), &["init", "--bare", "--initial-branch=main"]).await;
    command(
        dir.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    )
    .await;
    command(dir.path(), &["push", "origin", "main:feature"]).await;
    branch::switch(&repo, "origin/feature").await.unwrap();
    let status = repo.refresh().await.unwrap();
    assert_eq!(status.branch, "feature");
    assert_eq!(status.upstream.as_deref(), Some("origin/feature"));
    branch::switch(&repo, "main").await.unwrap();
    branch::switch(&repo, "origin/feature").await.unwrap();
    assert_eq!(repo.refresh().await.unwrap().branch, "feature");
    command(dir.path(), &["branch", "--unset-upstream"]).await;
    branch::switch(&repo, "main").await.unwrap();
    assert!(branch::switch(&repo, "origin/feature")
        .await
        .unwrap_err()
        .message
        .contains("different reference"));
    branch::switch(&repo, "feature").await.unwrap();
    std::fs::write(dir.path().join("feature.txt"), "feature").unwrap();
    actions::files(&repo, &["feature.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "Feature").await.unwrap();
    command(dir.path(), &["push", "origin", "feature"]).await;
    branch::switch(&repo, "main").await.unwrap();
    branch::delete(&repo, "origin/feature").await.unwrap();
    let remote_branches = command(remote.path(), &["branch", "--list", "feature"]).await;
    assert!(remote_branches.is_empty());
}

async fn default_branches(repo: &Repository) -> Vec<String> {
    branch::list(repo)
        .await
        .unwrap()
        .into_iter()
        .filter(|branch| branch.default)
        .map(|branch| branch.name)
        .collect()
}
#[tokio::test]
async fn the_default_branch_named_by_the_remote_head_cannot_be_deleted() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    let remote = tempfile::tempdir().unwrap();
    command(remote.path(), &["init", "--bare", "--initial-branch=main"]).await;
    command(
        dir.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    )
    .await;
    command(dir.path(), &["push", "origin", "main", "main:feature"]).await;
    assert!(default_branches(&repo).await.is_empty());
    command(dir.path(), &["remote", "set-head", "origin", "main"]).await;
    assert_eq!(default_branches(&repo).await, ["main", "origin/main"]);
    branch::create(&repo, "other", "main").await.unwrap();
    branch::switch(&repo, "other").await.unwrap();
    for name in ["main", "origin/main"] {
        assert!(branch::delete(&repo, name)
            .await
            .unwrap_err()
            .message
            .contains("default branch"));
    }
    branch::delete(&repo, "origin/feature").await.unwrap();
}

#[tokio::test]
async fn file_text_reads_the_new_side_of_every_source_within_the_limits() {
    let (dir, handle) = fixture().await;
    let repo = handle.clone();
    std::fs::write(dir.path().join("file.txt"), "base\n").unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "Base").await.unwrap();
    let base = command(dir.path(), &["rev-parse", "HEAD"]).await;
    std::fs::write(dir.path().join("file.txt"), "indexed\n").unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    std::fs::write(dir.path().join("file.txt"), "working\n").unwrap();
    let text = |source: DiffSource, revision: String, base: String| {
        file_text(
            &repo,
            FileText {
                source,
                revision,
                base,
                side: Side::New,
            },
        )
    };
    assert_eq!(
        text(DiffSource::Unstaged, String::new(), String::new())
            .await
            .as_deref(),
        Some("working\n")
    );
    assert_eq!(
        text(DiffSource::Staged, String::new(), String::new())
            .await
            .as_deref(),
        Some("indexed\n")
    );
    assert_eq!(
        text(DiffSource::Commit, base.trim().into(), String::new())
            .await
            .as_deref(),
        Some("base\n")
    );
    assert_eq!(
        text(DiffSource::Compare, "HEAD".into(), base.trim().into())
            .await
            .as_deref(),
        Some("base\n")
    );
    std::fs::write(dir.path().join("file.txt"), b"bin\0ary").unwrap();
    assert!(text(DiffSource::Unstaged, String::new(), String::new())
        .await
        .is_none());
    std::fs::write(dir.path().join("file.txt"), "x\n".repeat(50001)).unwrap();
    assert!(text(DiffSource::Unstaged, String::new(), String::new())
        .await
        .is_none());
    std::fs::write(dir.path().join("file.txt"), "x".repeat(2 * 1024 * 1024 + 1)).unwrap();
    assert!(text(DiffSource::Unstaged, String::new(), String::new())
        .await
        .is_none());
}

#[tokio::test]
async fn file_text_reads_the_old_side_of_every_source() {
    let (dir, handle) = fixture().await;
    let repo = handle.clone();
    std::fs::write(dir.path().join("file.txt"), "base\n").unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "Base").await.unwrap();
    let base = command(dir.path(), &["rev-parse", "HEAD"]).await;
    std::fs::write(dir.path().join("file.txt"), "second\n").unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "Second").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "indexed\n").unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    std::fs::write(dir.path().join("file.txt"), "working\n").unwrap();
    let text = |source: DiffSource, revision: String, base: String| {
        file_text(
            &repo,
            FileText {
                source,
                revision,
                base,
                side: Side::Old,
            },
        )
    };
    assert_eq!(
        text(DiffSource::Unstaged, String::new(), String::new())
            .await
            .as_deref(),
        Some("indexed\n")
    );
    assert_eq!(
        text(DiffSource::Staged, String::new(), String::new())
            .await
            .as_deref(),
        Some("second\n")
    );
    assert_eq!(
        text(DiffSource::Commit, "HEAD".into(), String::new())
            .await
            .as_deref(),
        Some("base\n")
    );
    assert_eq!(
        text(DiffSource::Compare, "HEAD".into(), base.trim().into())
            .await
            .as_deref(),
        Some("base\n")
    );
    assert_eq!(
        text(DiffSource::File, String::new(), String::new())
            .await
            .as_deref(),
        Some("")
    );
}

#[tokio::test]
async fn plain_text_line_limit_and_image_ceiling_apply_before_rendering() {
    let (dir, repo) = fixture().await;
    std::fs::write(dir.path().join("many.txt"), "x\n".repeat(50001)).unwrap();
    let limited = read_diff(&repo, DiffRef::working("many.txt", DiffSource::File))
        .await
        .unwrap();
    assert!(limited.too_large);
    assert!(limited.content.is_none());
    let expanded = diff::read(
        &repo,
        DiffRef::working("many.txt", DiffSource::File),
        ReadOptions::UNLIMITED,
    )
    .await
    .unwrap();
    assert!(expanded.added);
    assert_eq!(expanded.content.unwrap().lines().count(), 50001);
    let image = std::fs::File::create(dir.path().join("large.png")).unwrap();
    image.set_len(20 * 1024 * 1024 + 1).unwrap();
    assert!(
        diff::read(
            &repo,
            DiffRef::working("large.png", DiffSource::File),
            ReadOptions::UNLIMITED,
        )
        .await
        .unwrap()
        .too_large
    );
}

#[tokio::test]
async fn unborn_unstage_preserves_further_working_tree_edits() {
    let (dir, handle) = fixture().await;
    let repo = handle.clone();
    std::fs::write(dir.path().join("new.txt"), "staged\n").unwrap();
    actions::files(&repo, &["new.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    std::fs::write(dir.path().join("new.txt"), "further edits\n").unwrap();
    actions::files(&repo, &["new.txt".into()], FilesAction::Unstage)
        .await
        .unwrap();
    assert!(command(dir.path(), &["ls-files"]).await.is_empty());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("new.txt")).unwrap(),
        "further edits\n"
    );
}

#[tokio::test]
async fn crlf_hunks_preserve_exact_bytes_without_git_normalization() {
    let (dir, repo) = fixture().await;
    let original = "one\r\ntwo\r\nthree\r\n";
    let changed = "one\r\nchanged\r\nthree\r\n";
    std::fs::write(dir.path().join("file.txt"), original).unwrap();
    actions::files(&repo, &["file.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    actions::commit(&repo, "CRLF base").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), changed).unwrap();
    for (source, action) in [
        (DiffSource::Unstaged, "stage"),
        (DiffSource::Staged, "unstage"),
        (DiffSource::Unstaged, "discard"),
    ] {
        apply_first_hunk(&repo, source, action).await;
        assert_eq!(
            command(dir.path(), &["show", ":file.txt"]).await,
            index_after(action, changed, original)
        );
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        original
    );
}

#[tokio::test]
async fn revert_all_restores_staged_unstaged_renamed_and_new_files() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    command(dir.path(), &["mv", "file.txt", "renamed.txt"]).await;
    std::fs::write(dir.path().join("renamed.txt"), "changed").unwrap();
    std::fs::write(dir.path().join("added.txt"), "added").unwrap();
    command(dir.path(), &["add", "added.txt"]).await;
    std::fs::write(dir.path().join("untracked.txt"), "new").unwrap();
    let paths = repo
        .refresh()
        .await
        .unwrap()
        .entries
        .iter()
        .map(|entry| entry.path().to_owned())
        .collect::<Vec<_>>();
    actions::files(&repo, &paths, FilesAction::Revert)
        .await
        .unwrap();
    assert!(repo.refresh().await.unwrap().entries.is_empty());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "one\ntwo\nthree\n"
    );
    for path in ["renamed.txt", "added.txt", "untracked.txt"] {
        assert!(!dir.path().join(path).exists());
    }
}

#[tokio::test]
async fn revert_one_file_preserves_other_changes_and_handles_unborn_repo() {
    let (dir, handle) = fixture().await;
    std::fs::write(dir.path().join("added.txt"), "added").unwrap();
    std::fs::write(dir.path().join("keep.txt"), "keep").unwrap();
    command(dir.path(), &["add", "added.txt"]).await;
    let repo = handle.clone();
    repo.refresh().await.unwrap();
    actions::files(&repo, &["added.txt".into()], FilesAction::Revert)
        .await
        .unwrap();
    assert!(!dir.path().join("added.txt").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("keep.txt")).unwrap(),
        "keep"
    );
}

fn endpoint(base_url: &str, key: &str, timeout: Duration) -> ai::Endpoint {
    ai::Endpoint {
        timeout,
        ..ai::Endpoint::new(base_url, key)
    }
}
fn sample() -> ai::Material {
    ai::Material {
        text: "diff --git a/file.txt b/file.txt".into(),
        source: ai::Source::Index,
        detail: ai::Detail::Patch,
    }
}
async fn completion(server: &MockServer, response: ResponseTemplate) {
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(response)
        .mount(server)
        .await;
}

#[tokio::test]
async fn ai_lists_models_and_reports_an_absent_model_route() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "object": "list",
            "data": [
                {"id": "small", "object": "model", "created": 0, "owned_by": "local"},
                {"id": "large", "object": "model", "created": 0, "owned_by": "local"},
            ]
        })))
        .mount(&server)
        .await;
    let base = format!("{}/v1/", server.uri());
    let reachable = endpoint(&base, "key", Duration::from_secs(5));
    assert_eq!(reachable.base_url, format!("{}/v1", server.uri()));
    assert_eq!(
        ai::models(&reachable).await.unwrap(),
        vec!["large".to_string(), "small".to_string()]
    );
    let missing = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({"error": {"message": "no route"}})),
        )
        .mount(&missing)
        .await;
    let absent = ai::models(&endpoint(&missing.uri(), "key", Duration::from_secs(5)))
        .await
        .unwrap_err();
    assert_eq!(absent.category, "refused");
    assert_eq!(absent.message, "The endpoint does not serve this route");
}

#[tokio::test]
async fn ai_accepts_a_local_endpoint_without_a_key_and_with_sparse_responses() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "object": "list",
            "data": [{"id": "qwen", "object": "model", "owned_by": "organization_owner"}]
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(body_partial_json(json!({"think": false})))
        .respond_with(
            ResponseTemplate::new(400)
                .set_body_string("Unrecognized request argument supplied: think"),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .and(body_partial_json(
            json!({"model": "qwen", "reasoning_effort": "none"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "choices": [{"message": {
                "role": "assistant",
                "content": "<think>weighing it up</think>\nAdd the thing"
            }}]
        })))
        .mount(&server)
        .await;
    let local = endpoint(&format!("{}/v1", server.uri()), "", Duration::from_secs(5));
    assert_eq!(ai::models(&local).await.unwrap(), vec!["qwen".to_string()]);
    let draft = ai::draft(
        &local,
        ai::Instructions {
            model: "qwen",
            template: "t",
        },
        sample(),
    )
    .await
    .unwrap();
    assert_eq!(draft.message, "Add the thing");
    assert_eq!(
        server.received_requests().await.unwrap().len(),
        3,
        "one model list, one rejected body, one accepted body"
    );
    assert_eq!(
        ai::strip_think_blocks("<reasoning>still going"),
        "",
        "an unterminated block yields no text"
    );
}

#[tokio::test]
async fn ai_reports_a_context_overflow_without_stepping_down_reasoning() {
    for response in [
        ResponseTemplate::new(400).set_body_json(json!({"error": {
            "message": "This model's maximum context length is 8192 tokens.",
            "type": "invalid_request_error",
            "param": "messages",
            "code": "context_length_exceeded"
        }})),
        ResponseTemplate::new(400).set_body_json(json!({"error": {
            "code": 400,
            "message": "the request exceeds the available context size, try increasing it",
            "type": "exceed_context_size_error"
        }})),
        ResponseTemplate::new(413)
            .set_body_json(json!({"error": {"message": "Request too large"}})),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(response)
            .expect(1)
            .mount(&server)
            .await;
        let error = ai::draft(
            &endpoint(
                &format!("{}/v1", server.uri()),
                "key",
                Duration::from_secs(5),
            ),
            ai::Instructions {
                model: "small",
                template: "t",
            },
            sample(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.category, "refused");
        assert_eq!(
            error.message,
            "The changes are too large for this model's context"
        );
    }
}

#[tokio::test]
async fn ai_drafts_a_message_and_reports_its_source_and_detail() {
    let server = MockServer::start().await;
    let generated: String = std::iter::repeat_n('m', ai::MESSAGE_CAP + 500).collect();
    completion(
        &server,
        ResponseTemplate::new(200).set_body_json(json!({
            "id": "one",
            "object": "chat.completion",
            "created": 0,
            "model": "small",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": format!("  \n{generated}\n  ")}
            }]
        })),
    )
    .await;
    let base = format!("{}/v1", server.uri());
    let draft = ai::draft(
        &endpoint(&base, "key", Duration::from_secs(5)),
        ai::Instructions {
            model: " small ",
            template: "Describe it.",
        },
        ai::Material {
            source: ai::Source::WorkingTree,
            detail: ai::Detail::Compacted,
            ..sample()
        },
    )
    .await
    .unwrap();
    assert_eq!(draft.message.chars().count(), ai::MESSAGE_CAP);
    assert_eq!(draft.source, ai::Source::WorkingTree);
    assert_eq!(draft.detail, ai::Detail::Compacted);
}

#[tokio::test]
async fn ai_generation_answers_while_a_repository_lock_is_held() {
    let (_dir, handle) = fixture().await;
    let server = MockServer::start().await;
    completion(
        &server,
        ResponseTemplate::new(200).set_body_json(json!({
            "id": "one",
            "object": "chat.completion",
            "created": 0,
            "model": "small",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "Add the thing"}
            }]
        })),
    )
    .await;
    let guard = handle.clone();
    let draft = ai::draft(
        &endpoint(
            &format!("{}/v1", server.uri()),
            "key",
            Duration::from_secs(5),
        ),
        ai::Instructions {
            model: "small",
            template: "Describe it.",
        },
        sample(),
    )
    .await
    .unwrap();
    assert_eq!(draft.message, "Add the thing");
    assert!(guard.root.exists());
}

async fn draft_error(base_url: &str, model: &str) -> gitviewer_lib::error::Error {
    ai::draft(
        &endpoint(base_url, "key", Duration::from_millis(80)),
        ai::Instructions {
            model,
            template: "t",
        },
        sample(),
    )
    .await
    .unwrap_err()
}

async fn server_draft_error(response: ResponseTemplate) -> gitviewer_lib::error::Error {
    let server = MockServer::start().await;
    completion(&server, response).await;
    draft_error(&format!("{}/v1", server.uri()), "small").await
}

#[tokio::test]
async fn ai_refuses_an_unconfigured_endpoint_and_maps_http_errors() {
    assert_eq!(
        draft_error("", "small").await.message,
        "No endpoint is configured"
    );
    assert_eq!(
        draft_error("https://example.invalid", "  ").await.message,
        "No model is configured"
    );
    let rejected = server_draft_error(
        ResponseTemplate::new(401).set_body_json(json!({"error": {"message": "bad key"}})),
    )
    .await;
    assert_eq!(rejected.category, "authentication");
    assert_eq!(rejected.message, "The endpoint rejected the API key");

    let refused =
        server_draft_error(ResponseTemplate::new(500).set_body_string("upstream exploded")).await;
    assert_eq!(refused.category, "refused");
    assert_eq!(
        refused.message,
        "The endpoint refused the request with status 500"
    );
    assert!(!refused.message.contains("upstream exploded"));
}

#[tokio::test]
async fn ai_rejects_malformed_empty_and_blank_completions() {
    assert_eq!(
        server_draft_error(ResponseTemplate::new(200).set_body_json(json!({"unexpected": true})))
            .await
            .message,
        "The endpoint returned a response the application could not read"
    );
    assert_eq!(
        server_draft_error(ResponseTemplate::new(200).set_body_json(json!({
            "id": "one",
            "object": "chat.completion",
            "created": 0,
            "model": "small",
            "choices": []
        })))
        .await
        .message,
        "The endpoint returned no message"
    );
    assert_eq!(
        server_draft_error(ResponseTemplate::new(200).set_body_json(json!({
            "id": "one",
            "object": "chat.completion",
            "created": 0,
            "model": "small",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "   "}
            }]
        })))
        .await
        .message,
        "The endpoint returned an empty message"
    );
}

#[tokio::test]
async fn ai_maps_a_timeout_and_an_unreachable_endpoint_to_the_network_category() {
    let slow = MockServer::start().await;
    completion(
        &slow,
        ResponseTemplate::new(200)
            .set_delay(Duration::from_secs(2))
            .set_body_json(json!({"choices": []})),
    )
    .await;
    let timed_out = ai::draft(
        &endpoint(
            &format!("{}/v1", slow.uri()),
            "key",
            Duration::from_millis(80),
        ),
        ai::Instructions {
            model: "small",
            template: "t",
        },
        sample(),
    )
    .await
    .unwrap_err();
    assert_eq!(timed_out.category, "network");
    assert_eq!(timed_out.message, "The endpoint did not answer in time");

    let unreachable = ai::models(&endpoint(
        "http://127.0.0.1:1",
        "key",
        Duration::from_secs(5),
    ))
    .await
    .unwrap_err();
    assert_eq!(unreachable.category, "network");
    assert_eq!(unreachable.message, "The endpoint could not be reached");
}

#[tokio::test]
async fn stash_conflicts_preserve_clean_files_local_changes_and_the_stash() {
    for case in STASH_CONFLICT_CASES {
        stash_conflict_case(case).await;
    }
}
#[derive(Clone, Copy)]
struct StashConflictCase {
    staged: bool,
    smart: bool,
}
const STASH_CONFLICT_CASES: [StashConflictCase; 4] = [
    StashConflictCase {
        staged: false,
        smart: false,
    },
    StashConflictCase {
        staged: false,
        smart: true,
    },
    StashConflictCase {
        staged: true,
        smart: false,
    },
    StashConflictCase {
        staged: true,
        smart: true,
    },
];
async fn prepare_stash_conflict(repo: &Repo, case: StashConflictCase) -> String {
    record(
        repo,
        Recorded {
            path: "clean.txt",
            body: "base\n",
            message: "clean base",
        },
    )
    .await;
    std::fs::write(repo.root.join("file.txt"), "stashed\n").unwrap();
    std::fs::write(repo.root.join("clean.txt"), "clean stash\n").unwrap();
    if case.staged {
        command(&repo.root, &["add", "."]).await;
    }
    let hash = stash::save(repo, "conflicting").await.unwrap();
    record(
        repo,
        Recorded {
            path: "file.txt",
            body: "upstream\n",
            message: "upstream",
        },
    )
    .await;
    if case.smart {
        std::fs::write(repo.root.join("local.txt"), "local\n").unwrap();
        command(&repo.root, &["add", "local.txt"]).await;
    }
    hash
}
fn assert_stash_conflict_files(root: &Path) {
    let conflict = std::fs::read_to_string(root.join("file.txt")).unwrap();
    assert!(conflict.contains("<<<<<<<"));
    assert!(conflict.contains("stashed"));
    assert!(conflict.contains("upstream"));
    assert_eq!(
        std::fs::read_to_string(root.join("clean.txt")).unwrap(),
        "clean stash\n"
    );
}
async fn stash_conflict_case(case: StashConflictCase) {
    let (_dir, repo) = fixture().await;
    base(&repo).await;
    let hash = prepare_stash_conflict(&repo, case).await;
    stash::apply(
        &repo,
        &hash,
        stash::ApplyOptions {
            pop: true,
            smart: case.smart,
        },
    )
    .await
    .unwrap();
    let status = repo.refresh().await.unwrap();
    assert!(status.conflicted);
    assert!(status.merging.is_none());
    assert_stash_conflict_files(&repo.root);
    assert_eq!(stash::list(&repo).await.unwrap()[0].hash, hash);
    if case.smart {
        assert_eq!(
            command(&repo.root, &["show", ":local.txt"]).await,
            "local\n"
        );
    }
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    bytes.extend(width.to_be_bytes());
    bytes.extend(height.to_be_bytes());
    bytes.extend([8, 6, 0, 0, 0]);
    bytes
}
fn jpeg(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = vec![0xff, 0xd8, 0xff, 0xe1, 0xff, 0xf0];
    bytes.extend(vec![0x20; 0xffee]);
    bytes.extend([0xff, 0xc0, 0x00, 0x11, 0x08]);
    bytes.extend(height.to_be_bytes());
    bytes.extend(width.to_be_bytes());
    bytes.extend([0x03, 0x01, 0x22, 0x00]);
    bytes
}
fn numbered(prefix: &str, count: usize) -> String {
    (0..count)
        .map(|index| format!("{prefix}{index}\n"))
        .collect()
}
struct IndexEntry<'a> {
    path: &'a str,
    bytes: &'a [u8],
    mode: &'a str,
}
async fn place(root: &Path, entry: IndexEntry<'_>) {
    let IndexEntry { path, bytes, mode } = entry;
    let oid = git::run(root, &["hash-object", "-w", "--stdin"], Some(bytes))
        .await
        .unwrap()
        .accept(&[0])
        .unwrap()
        .text();
    command(
        root,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("{mode},{},{path}", oid.trim()),
        ],
    )
    .await;
}
fn parsed(stack: &diff::stack::Stack) -> usize {
    stack
        .files
        .values()
        .map(|entry| {
            entry
                .hunks
                .iter()
                .map(|hunk| hunk.lines.len())
                .sum::<usize>()
                + entry
                    .content
                    .as_deref()
                    .map_or(0, |text| text.lines().count())
        })
        .sum()
}
async fn equivalent(repo: &Repo, reference: StackRef<'_>, expected: &[&str]) -> diff::stack::Stack {
    let StackRef {
        source,
        revision,
        base,
    } = reference;
    let stack = diff::stack::read(repo, reference).await.unwrap();
    for path in expected {
        assert!(stack.files.contains_key(*path), "{source:?} lacks {path}");
    }
    for (path, entry) in &stack.files {
        let single = read_diff(
            repo,
            DiffRef {
                path,
                source: entry.source,
                revision,
                base,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::to_value(entry).unwrap(),
            serde_json::to_value(&single).unwrap(),
            "{source:?} {path}"
        );
    }
    stack
}
async fn seed_stack_root(root: &Path) -> String {
    let write = |path: &str, bytes: &[u8]| std::fs::write(root.join(path), bytes).unwrap();
    write("modified.txt", b"one\ntwo\nthree\n");
    write("deleted.txt", b"gone\n");
    write("mode.sh", b"echo\n");
    write("type.txt", b"target\n");
    write("binary.bin", b"\0\x01\x02");
    write("picture.png", &png(1, 1));
    write("vector.svg", b"<svg width='1'/>\n");
    write("space name.txt", b"a\n");
    write("\u{fc}n\u{ef}.txt", b"a\n");
    write("rename-me.txt", numbered("line ", 20).as_bytes());
    command(root, &["add", "-A"]).await;
    place(
        root,
        IndexEntry {
            path: "q\"uote.txt",
            bytes: b"a\n",
            mode: "100644",
        },
    )
    .await;
    command(root, &["commit", "-m", "Root"]).await;
    command(root, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned()
}
fn apply_working_stack_edits(root: &Path) {
    let write = |path: &str, bytes: &[u8]| std::fs::write(root.join(path), bytes).unwrap();
    write("modified.txt", b"one\nTWO\nthree\n");
    std::fs::remove_file(root.join("deleted.txt")).unwrap();
    write("added.txt", b"new\n");
    write("empty.txt", b"");
    write("binary.bin", b"\0\x03\x04");
    write("picture.png", &png(2, 3));
    write("vector.svg", b"<svg width='2'/>\n");
    write("photo.jpg", &jpeg(640, 480));
    write("space name.txt", b"b\n");
    write("\u{fc}n\u{ef}.txt", b"b\n");
    write("huge.txt", numbered(&"x".repeat(120), 18_000).as_bytes());
    write("minified.js", &vec![b'm'; 2 * 1024 * 1024 + 10]);
    write("long.txt", numbered("", 50_001).as_bytes());
    std::fs::rename(root.join("rename-me.txt"), root.join("renamed.txt")).unwrap();
}
async fn stage_stack_edits(root: &Path) {
    command(root, &["add", "-A"]).await;
    command(root, &["update-index", "--chmod=+x", "mode.sh"]).await;
    place(
        root,
        IndexEntry {
            path: "type.txt",
            bytes: b"modified.txt",
            mode: "120000",
        },
    )
    .await;
    place(
        root,
        IndexEntry {
            path: "q\"uote.txt",
            bytes: b"b\n",
            mode: "100644",
        },
    )
    .await;
}
fn assert_unstaged_stack_flags(unstaged: &diff::stack::Stack) {
    assert_eq!(unstaged.files["added.txt"].source, DiffSource::File);
    assert!(unstaged.files["added.txt"].added);
    assert!(unstaged.files["huge.txt"].too_large);
    assert!(unstaged.files["minified.js"].too_large);
    assert!(unstaged.files["long.txt"].too_large);
    assert!(unstaged.files["binary.bin"].binary);
    assert_eq!(
        unstaged.files["photo.jpg"].new_dimensions,
        Some(diff::Dimensions {
            width: 640,
            height: 480,
        })
    );
    assert!(!unstaged.truncated);
}
#[tokio::test]
async fn stacked_entries_equal_single_reads_for_root_unstaged_and_staged() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    let first = seed_stack_root(root).await;
    repo.refresh().await.unwrap();
    equivalent(
        &repo,
        commit_stack(&first),
        &[
            "modified.txt",
            "picture.png",
            "q\"uote.txt",
            "\u{fc}n\u{ef}.txt",
        ],
    )
    .await;
    apply_working_stack_edits(root);
    repo.refresh().await.unwrap();
    let unstaged = equivalent(
        &repo,
        working_stack(DiffSource::Unstaged),
        &[
            "modified.txt",
            "deleted.txt",
            "binary.bin",
            "picture.png",
            "vector.svg",
            "space name.txt",
            "\u{fc}n\u{ef}.txt",
            "added.txt",
            "empty.txt",
            "photo.jpg",
            "huge.txt",
            "minified.js",
            "long.txt",
            "renamed.txt",
            "rename-me.txt",
        ],
    )
    .await;
    assert_unstaged_stack_flags(&unstaged);
}
#[tokio::test]
async fn stacked_entries_equal_single_reads_for_staged_commits_compare_and_stashes() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    let first = seed_stack_root(root).await;
    apply_working_stack_edits(root);
    stage_stack_edits(root).await;
    repo.refresh().await.unwrap();
    let staged = equivalent(
        &repo,
        working_stack(DiffSource::Staged),
        &[
            "modified.txt",
            "deleted.txt",
            "added.txt",
            "empty.txt",
            "mode.sh",
            "type.txt",
            "q\"uote.txt",
            "renamed.txt",
            "long.txt",
            "photo.jpg",
        ],
    )
    .await;
    assert!(!staged.files.contains_key("rename-me.txt"));
    assert_eq!(staged.files["mode.sh"].new_mode.as_deref(), Some("100755"));
    assert_eq!(staged.files["type.txt"].hunks.len(), 2);
    assert!(staged.files["empty.txt"].hunks.is_empty());
    let worktree = equivalent(
        &repo,
        working_stack(DiffSource::Unstaged),
        &["type.txt", "q\"uote.txt"],
    )
    .await;
    assert!(worktree.files.contains_key("type.txt"));
    command(root, &["commit", "-m", "Second"]).await;
    let second = command(root, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned();
    repo.refresh().await.unwrap();
    let commit = equivalent(
        &repo,
        commit_stack(&second),
        &[
            "type.txt",
            "mode.sh",
            "rename-me.txt",
            "renamed.txt",
            "photo.jpg",
        ],
    )
    .await;
    assert!(commit.files["rename-me.txt"].old_size > 0);
    equivalent(
        &repo,
        compare_stack(&second, &first),
        &["type.txt", "renamed.txt"],
    )
    .await;
}
#[tokio::test]
async fn stacked_entries_equal_single_reads_for_stashes() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    seed_stack_root(root).await;
    apply_working_stack_edits(root);
    stage_stack_edits(root).await;
    command(root, &["commit", "-m", "Second"]).await;
    std::fs::write(root.join("modified.txt"), b"stashed\n").unwrap();
    command(root, &["rm", "--cached", "-q", "space name.txt"]).await;
    std::fs::write(root.join("stashed-new.txt"), b"fresh\n").unwrap();
    std::fs::write(root.join("stashed.png"), png(4, 5)).unwrap();
    repo.refresh().await.unwrap();
    let hash = stash::save(&repo, "Mixed").await.unwrap();
    let stashed = equivalent(
        &repo,
        stash_stack(&hash),
        &[
            "modified.txt",
            "stashed-new.txt",
            "space name.txt",
            "stashed.png",
        ],
    )
    .await;
    assert!(stashed.files["space name.txt"].added);
    assert_eq!(
        stashed.files["space name.txt"].content.as_deref(),
        Some("b\n")
    );
    assert_eq!(
        stashed.files["stashed.png"].new_dimensions,
        Some(diff::Dimensions {
            width: 4,
            height: 5,
        })
    );
}
#[tokio::test]
async fn stacked_entries_handle_unborn_repos_and_invalid_sources() {
    let (unborn, fresh) = fixture().await;
    std::fs::write(unborn.path().join("first.txt"), "first\n").unwrap();
    actions::files(&fresh, &["first.txt".into()], FilesAction::Stage)
        .await
        .unwrap();
    fresh.refresh().await.unwrap();
    equivalent(&fresh, working_stack(DiffSource::Staged), &["first.txt"]).await;
    assert!(diff::stack::read(&fresh, commit_stack("HEAD"))
        .await
        .is_err());
    assert!(diff::stack::read(&fresh, working_stack(DiffSource::File))
        .await
        .is_err());
    assert!(equivalent(&fresh, working_stack(DiffSource::Unstaged), &[])
        .await
        .files
        .is_empty());
}
async fn seed_unreproducible_stack_entries(repo: &Repo) {
    let root = repo.root.as_path();
    base(repo).await;
    command(root, &["checkout", "-q", "-b", "other"]).await;
    record(
        repo,
        Recorded {
            path: "file.txt",
            body: "theirs\n",
            message: "Theirs",
        },
    )
    .await;
    command(root, &["checkout", "-q", "main"]).await;
    record(
        repo,
        Recorded {
            path: "file.txt",
            body: "ours\n",
            message: "Ours",
        },
    )
    .await;
    let head = command(root, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned();
    git::run(root, &["merge", "other"], None).await.unwrap();
    place(
        root,
        IndexEntry {
            path: "sub",
            bytes: head.as_bytes(),
            mode: "100644",
        },
    )
    .await;
    command(
        root,
        &["update-index", "--cacheinfo", &format!("160000,{head},sub")],
    )
    .await;
    place(
        root,
        IndexEntry {
            path: "new\nline.txt",
            bytes: b"x\n",
            mode: "100644",
        },
    )
    .await;
    std::fs::create_dir_all(root.join("nested")).unwrap();
    command(&root.join("nested"), &["init", "-q"]).await;
    std::fs::write(root.join("nested/inner.txt"), "inner").unwrap();
    repo.refresh().await.unwrap();
}
#[tokio::test]
async fn stacks_omit_records_they_cannot_reproduce() {
    let (_dir, repo) = fixture().await;
    seed_unreproducible_stack_entries(&repo).await;
    for source in [DiffSource::Unstaged, DiffSource::Staged] {
        let stack = read_stack(&repo, source).await;
        let listed: Vec<&str> = ["file.txt", "sub", "new\nline.txt", "nested/"]
            .into_iter()
            .filter(|path| stack.files.contains_key(*path))
            .collect();
        assert!(listed.is_empty(), "{source:?} {listed:?}");
    }
    assert!(
        read_diff(&repo, DiffRef::working("file.txt", DiffSource::Unstaged))
            .await
            .is_err()
    );
    assert!(
        read_diff(&repo, DiffRef::working("file.txt", DiffSource::Staged))
            .await
            .is_err()
    );
    assert!(
        read_diff(&repo, DiffRef::working("sub", DiffSource::Staged))
            .await
            .is_ok()
    );
    assert!(
        read_diff(&repo, DiffRef::working("new\nline.txt", DiffSource::Staged))
            .await
            .is_ok()
    );
    assert!(
        read_diff(&repo, DiffRef::working("nested/", DiffSource::File))
            .await
            .is_err()
    );
}
#[cfg(unix)]
#[tokio::test]
async fn stacks_omit_symlink_escapes() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    base(&repo).await;
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), "secret\n").unwrap();
    std::fs::write(outside.path().join("linked.txt"), "linked\n").unwrap();
    std::fs::create_dir(root.join("dir")).unwrap();
    record(
        &repo,
        Recorded {
            path: "dir/linked.txt",
            body: "tracked\n",
            message: "Directory",
        },
    )
    .await;
    std::fs::remove_dir_all(root.join("dir")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("dir")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.txt"), root.join("escape.txt")).unwrap();
    repo.refresh().await.unwrap();
    let stack = read_stack(&repo, DiffSource::Unstaged).await;
    assert!(!stack.files.contains_key("dir/linked.txt"));
    assert!(!stack.files.contains_key("escape.txt"));
    assert!(read_diff(
        &repo,
        DiffRef::working("dir/linked.txt", DiffSource::Unstaged)
    )
    .await
    .is_err());
    assert!(
        read_diff(&repo, DiffRef::working("escape.txt", DiffSource::File))
            .await
            .is_err()
    );
}
async fn configure_adversarial_diff_options(root: &Path) {
    for (key, value) in [
        ("diff.mnemonicPrefix", "true"),
        ("diff.noprefix", "true"),
        ("diff.submodule", "log"),
        ("diff.renames", "true"),
        ("log.showRoot", "false"),
    ] {
        command(root, &["config", key, value]).await;
    }
}
#[tokio::test]
async fn stacks_ignore_diff_configuration_for_commits_and_working_tree() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    configure_adversarial_diff_options(root).await;
    let body = numbered("row ", 30);
    record(
        &repo,
        Recorded {
            path: "before.txt",
            body: &body,
            message: "Root",
        },
    )
    .await;
    let first = command(root, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned();
    assert_eq!(
        read_diff(
            &repo,
            DiffRef {
                path: "before.txt",
                source: DiffSource::Commit,
                revision: &first,
                base: "",
            }
        )
        .await
        .unwrap()
        .hunks
        .len(),
        1
    );
    equivalent(
        &repo,
        StackRef {
            source: DiffSource::Commit,
            revision: &first,
            base: "",
        },
        &["before.txt"],
    )
    .await;
    std::fs::rename(root.join("before.txt"), root.join("after.txt")).unwrap();
    command(root, &["add", "-A"]).await;
    repo.refresh().await.unwrap();
    equivalent(
        &repo,
        StackRef {
            source: DiffSource::Staged,
            revision: "",
            base: "",
        },
        &["after.txt"],
    )
    .await;
}
#[tokio::test]
async fn stacks_follow_status_rename_pairing_across_sources() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    configure_adversarial_diff_options(root).await;
    let body = numbered("row ", 30);
    record(
        &repo,
        Recorded {
            path: "before.txt",
            body: &body,
            message: "Root",
        },
    )
    .await;
    let first = command(root, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned();
    std::fs::rename(root.join("before.txt"), root.join("after.txt")).unwrap();
    command(root, &["add", "-A"]).await;
    command(root, &["commit", "-m", "Rename"]).await;
    let second = command(root, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned();
    std::fs::write(root.join("after.txt"), numbered("changed ", 30)).unwrap();
    repo.refresh().await.unwrap();
    equivalent(&repo, working_stack(DiffSource::Unstaged), &["after.txt"]).await;
    for reference in [commit_stack(&second), compare_stack(&second, &first)] {
        let stack = equivalent(&repo, reference, &["before.txt", "after.txt"]).await;
        assert_eq!(stack.files["after.txt"].old_size, 0);
    }
    command(root, &["mv", "after.txt", "later.txt"]).await;
    command(root, &["config", "status.renames", "false"]).await;
    repo.refresh().await.unwrap();
    let stack = equivalent(&repo, working_stack(DiffSource::Staged), &[]).await;
    assert!(!stack.files.contains_key("later.txt"));
}
async fn seed_budget_files(root: &Path) {
    for path in ["a.txt", "b.txt", "c.txt", "0huge.txt", "0image.svg"] {
        std::fs::write(root.join(path), "").unwrap();
    }
    command(root, &["add", "-A"]).await;
    command(root, &["commit", "-m", "Empty"]).await;
}
#[tokio::test]
async fn stack_budget_truncates_whole_files_and_skips_unparsed_ones() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    seed_budget_files(root).await;
    std::fs::write(root.join("0huge.txt"), numbered("h", 400_000)).unwrap();
    std::fs::write(root.join("0image.svg"), numbered("s", 60_000)).unwrap();
    std::fs::write(root.join("a.txt"), numbered("a", 49_000)).unwrap();
    std::fs::write(root.join("b.txt"), numbered("b", 49_000)).unwrap();
    repo.refresh().await.unwrap();
    let whole = read_stack(&repo, DiffSource::Unstaged).await;
    assert!(!whole.truncated);
    assert!(whole.files["0huge.txt"].too_large);
    assert!(whole.files["0image.svg"].image);
    assert!(whole.files.contains_key("b.txt"));
    assert_eq!(parsed(&whole), 98_000);
    for path in ["0huge.txt", "0image.svg"] {
        std::fs::write(root.join(path), "").unwrap();
    }
    for path in ["a.txt", "b.txt", "c.txt"] {
        std::fs::write(root.join(path), numbered(path, 45_000)).unwrap();
    }
    std::fs::write(root.join("u1.txt"), numbered("u", 5_000)).unwrap();
    std::fs::write(root.join("u2.txt"), numbered("u", 6_000)).unwrap();
    std::fs::write(root.join("u3.txt"), "u\n").unwrap();
    repo.refresh().await.unwrap();
    let cut = read_stack(&repo, DiffSource::Unstaged).await;
    assert!(cut.truncated);
    assert!(cut.files.contains_key("a.txt") && cut.files.contains_key("b.txt"));
    assert!(!cut.files.contains_key("c.txt"));
    assert!(cut.files.contains_key("u1.txt"));
    assert!(!cut.files.contains_key("u2.txt") && !cut.files.contains_key("u3.txt"));
    assert!(parsed(&cut) <= 100_000);
    assert_eq!(cut.files["a.txt"].hunks[0].lines.len(), 45_000);
}
#[tokio::test]
async fn stack_budget_truncates_stash_untracked_files() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    seed_budget_files(root).await;
    std::fs::write(root.join("a.txt"), numbered("a", 49_990)).unwrap();
    std::fs::write(root.join("b.txt"), numbered("b", 49_990)).unwrap();
    record(
        &repo,
        Recorded {
            path: "shared.txt",
            body: "tracked\n",
            message: "Shared",
        },
    )
    .await;
    command(root, &["rm", "--cached", "-q", "shared.txt"]).await;
    std::fs::write(root.join("shared.txt"), numbered("s", 100)).unwrap();
    repo.refresh().await.unwrap();
    let hash = stash::save(&repo, "Budget").await.unwrap();
    let stashed = diff::stack::read(
        &repo,
        StackRef {
            source: DiffSource::Stash,
            revision: &hash,
            base: "",
        },
    )
    .await
    .unwrap();
    assert!(stashed.truncated);
    assert!(stashed.files.contains_key("b.txt"));
    assert!(!stashed.files.contains_key("shared.txt"));
}
#[tokio::test]
async fn stacked_hunk_patches_apply() {
    let (dir, repo) = fixture().await;
    base(&repo).await;
    std::fs::write(dir.path().join("file.txt"), "one\nTWO\nthree\n").unwrap();
    repo.refresh().await.unwrap();
    let unstaged = read_stack(&repo, DiffSource::Unstaged).await;
    let patch = diff::patch("file.txt", &unstaged.files["file.txt"].hunks[0]).unwrap();
    diff::apply_hunk(
        &repo,
        HunkRequest {
            path: "file.txt",
            source: DiffSource::Unstaged,
            hunk: 0,
            expected: &patch,
            action: "stage",
        },
    )
    .await
    .unwrap();
    let staged = read_stack(&repo, DiffSource::Staged).await;
    let patch = diff::patch("file.txt", &staged.files["file.txt"].hunks[0]).unwrap();
    diff::apply_hunk(
        &repo,
        HunkRequest {
            path: "file.txt",
            source: DiffSource::Staged,
            hunk: 0,
            expected: &patch,
            action: "unstage",
        },
    )
    .await
    .unwrap();
    assert!(read_stack(&repo, DiffSource::Staged).await.files.is_empty());
}
async fn count_commit_stack(trace: &Path, repo: &Repo, revision: &str) -> usize {
    counted(trace, async {
        diff::stack::read(repo, commit_stack(revision))
            .await
            .unwrap()
    })
    .await
}
async fn count_diff(trace: &Path, repo: &Repo, reference: DiffRef<'_>) -> usize {
    counted(trace, async { read_diff(repo, reference).await.unwrap() }).await
}
#[tokio::test]
async fn stacks_and_single_file_reads_run_a_fixed_number_of_git_processes() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    record(
        &repo,
        Recorded {
            path: "seed.txt",
            body: "seed\n",
            message: "Seed",
        },
    )
    .await;
    for count in [2, 5] {
        write_numbered_files(root, count);
        command(root, &["add", "-A"]).await;
        command(root, &["commit", "-m", "Batch"]).await;
    }
    std::fs::write(root.join("seed.txt"), "changed\n").unwrap();
    command(root, &["commit", "-am", "Modify"]).await;
    repo.refresh().await.unwrap();
    let trace = trace_file(&dir, "trace");
    std::env::set_var("GIT_TRACE2_EVENT", &trace);
    repo.snapshot().await.unwrap();
    let wide = count_commit_stack(&trace, &repo, "HEAD~1").await;
    let narrow = count_commit_stack(&trace, &repo, "HEAD~2").await;
    let modified = count_diff(
        &trace,
        &repo,
        DiffRef {
            path: "seed.txt",
            source: DiffSource::Commit,
            revision: "HEAD",
            base: "",
        },
    )
    .await;
    let added = count_diff(
        &trace,
        &repo,
        DiffRef {
            path: "f5-0.txt",
            source: DiffSource::Commit,
            revision: "HEAD~1",
            base: "",
        },
    )
    .await;
    std::env::remove_var("GIT_TRACE2_EVENT");
    std::fs::remove_file(&trace).ok();
    assert_eq!((wide, narrow, modified, added), (3, 3, 3, 4));
}
#[tokio::test]
async fn concurrent_snapshots_of_a_stale_repository_read_status_once() {
    let (dir, handle) = fixture().await;
    let trace = trace_file(&dir, "snapshot-trace");
    std::env::set_var("GIT_TRACE2_EVENT", &trace);
    handle.stale.store(true, Ordering::SeqCst);
    let reads = counted(&trace, async {
        let (first, second, third) =
            tokio::join!(handle.snapshot(), handle.snapshot(), handle.snapshot());
        first.unwrap();
        second.unwrap();
        third.unwrap();
    })
    .await;
    std::env::remove_var("GIT_TRACE2_EVENT");
    std::fs::remove_file(&trace).ok();
    assert_eq!(reads, 1);
}

async fn commit_all(root: &Path, message: &str) {
    command(root, &["add", "-A"]).await;
    command(root, &["commit", "-q", "-m", message]).await;
}
fn many(root: &Path, directory: &str, count: usize) {
    std::fs::create_dir_all(root.join(directory)).unwrap();
    for index in 0..count {
        std::fs::write(
            root.join(directory).join(format!("{index}.txt")),
            format!("{index}\n"),
        )
        .unwrap();
    }
}
#[tokio::test]
async fn revert_removes_every_added_file_with_one_rm_process() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let root = dir.path();
    let trace = trace_file(&dir, "revert-trace");
    std::env::set_var("GIT_TRACE2_EVENT", &trace);
    for count in [1, 2000] {
        many(root, "added", count);
        command(root, &["add", "-A"]).await;
        std::fs::write(root.join("file.txt"), "changed\n").unwrap();
        std::fs::write(root.join("loose.txt"), "loose\n").unwrap();
        let paths: Vec<String> = handle
            .refresh()
            .await
            .unwrap()
            .entries
            .iter()
            .map(|entry| entry.path().to_owned())
            .collect();
        assert_eq!(paths.len(), count + 2);
        let from = trace_size(&trace);
        actions::files(&handle, &paths, FilesAction::Revert)
            .await
            .unwrap();
        assert_eq!(launched(&trace, from, "rm"), 1, "{count}");
        assert!(handle.refresh().await.unwrap().entries.is_empty());
        assert!(command(root, &["ls-files", "added"]).await.is_empty());
        assert!(!root.join("added").join("0.txt").exists());
        assert!(!root.join("loose.txt").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("file.txt")).unwrap(),
            "one\ntwo\nthree\n"
        );
    }
    std::env::remove_var("GIT_TRACE2_EVENT");
    std::fs::remove_file(&trace).ok();
}
#[tokio::test]
async fn staged_pairing_unstage_and_revert_handle_thousands_of_renames() {
    let (dir, handle) = fixture().await;
    let root = dir.path();
    many(root, "before", 2000);
    let long = numbered("row ", 20);
    std::fs::write(root.join("before").join("0.txt"), &long).unwrap();
    commit_all(root, "Many").await;
    std::fs::rename(root.join("before"), root.join("after")).unwrap();
    std::fs::write(
        root.join("after").join("0.txt"),
        long.replace("row 10\n", "changed\n"),
    )
    .unwrap();
    command(root, &["add", "-A"]).await;
    let status = handle.refresh().await.unwrap();
    assert_eq!(status.entries.len(), 2000);
    assert!(status
        .entries
        .iter()
        .all(|entry| entry.original_path().is_some()));
    let staged = read_stack(&handle, DiffSource::Staged).await;
    assert_eq!(staged.files.len(), 2000);
    assert!(staged.files.keys().all(|path| path.starts_with("after/")));
    let single = read_diff(&handle, DiffRef::working("after/0.txt", DiffSource::Staged))
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&staged.files["after/0.txt"]).unwrap(),
        serde_json::to_value(&single).unwrap()
    );
    let paths: Vec<String> = status
        .entries
        .iter()
        .map(|entry| entry.path().to_owned())
        .collect();
    actions::files(&handle, &paths, FilesAction::Unstage)
        .await
        .unwrap();
    assert!(command(root, &["diff", "--cached", "--name-only"])
        .await
        .is_empty());
    assert!(root.join("after").join("1999.txt").exists());
    command(root, &["add", "-A"]).await;
    handle.refresh().await.unwrap();
    actions::files(&handle, &paths, FilesAction::Revert)
        .await
        .unwrap();
    assert!(handle.refresh().await.unwrap().entries.is_empty());
    assert!(
        !root.join("after").exists()
            || std::fs::read_dir(root.join("after"))
                .unwrap()
                .next()
                .is_none()
    );
    assert_eq!(
        std::fs::read_to_string(root.join("before").join("0.txt")).unwrap(),
        long
    );
}
#[tokio::test]
async fn smart_apply_checks_overlap_against_thousands_of_local_changes() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let root = dir.path();
    std::fs::write(root.join("file.txt"), "stashed\n").unwrap();
    let target = stash::save(&handle, "target").await.unwrap();
    many(root, "local", 2000);
    stash::apply(
        &handle,
        &target,
        stash::ApplyOptions {
            pop: true,
            smart: true,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("file.txt")).unwrap(),
        "stashed\n"
    );
    assert!(root.join("local").join("1999.txt").exists());
    std::fs::remove_dir_all(root.join("local")).unwrap();
    let target = stash::save(&handle, "again").await.unwrap();
    many(root, "local", 2000);
    std::fs::write(root.join("file.txt"), "overlap\n").unwrap();
    let refused = stash::apply(
        &handle,
        &target,
        stash::ApplyOptions {
            pop: false,
            smart: true,
        },
    )
    .await
    .unwrap_err()
    .message;
    assert_eq!(refused, "Stashes share paths: file.txt");
}
#[cfg(unix)]
async fn extend_with_symlinks(handle: &Repository, inputs: &mut Vec<String>) -> TempDir {
    let root = &handle.root;
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.txt"), "secret\n").unwrap();
    std::fs::write(outside.path().join("other.txt"), "other\n").unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("linked")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.txt"), root.join("escape.txt")).unwrap();
    std::os::unix::fs::symlink("missing-target", root.join("dangling")).unwrap();
    std::os::unix::fs::symlink("file.txt", root.join("inside.txt")).unwrap();
    commit_all(root, "Links").await;
    inputs.extend([
        "linked/secret.txt".into(),
        "linked/missing/deep.txt".into(),
        "linked".into(),
        "escape.txt".into(),
        "dangling".into(),
        "inside.txt".into(),
    ]);
    std::fs::remove_file(root.join("escape.txt")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("other.txt"), root.join("escape.txt")).unwrap();
    handle.refresh().await.unwrap();
    let refused = actions::files(handle, &["escape.txt".into()], FilesAction::Stage)
        .await
        .unwrap_err();
    assert_eq!(refused.message, "Symlink points outside the repository");
    let stack = read_stack(handle, DiffSource::Unstaged).await;
    assert!(!stack.files.contains_key("escape.txt"));
    let mut paths = handle.paths();
    assert!(paths.resolve("dangling").is_ok());
    assert!(paths.resolve("linked/secret.txt").is_err());
    outside
}
#[tokio::test]
async fn batch_path_checks_refuse_and_accept_exactly_like_single_checks() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let root = dir.path();
    std::fs::create_dir_all(root.join("src").join("nested")).unwrap();
    std::fs::write(root.join("src").join("nested").join("kept.txt"), "kept\n").unwrap();
    let mut inputs = vec![
        "/absolute".to_string(),
        "../outside".into(),
        "src/../../outside".into(),
        ".git/config".into(),
        "src/.GIT/config".into(),
        "file.txt".into(),
        "src/nested/kept.txt".into(),
        "src/nested/missing.txt".into(),
        "src/new/deeper/missing.txt".into(),
        "src".into(),
        "./file.txt".into(),
    ];
    #[cfg(unix)]
    let _outside = extend_with_symlinks(&handle, &mut inputs).await;
    let mut paths = handle.paths();
    let mut refusals = 0;
    for input in &inputs {
        let single = handle.path(input).map_err(|error| error.message);
        let batch = paths.resolve(input).map_err(|error| error.message);
        assert_eq!(batch, single, "{input}");
        refusals += usize::from(single.is_err());
    }
    assert_eq!(
        paths.resolve("src/nested/kept.txt").unwrap(),
        handle.root.join("src/nested/kept.txt")
    );
    assert!(refusals >= 5);
}
fn repository_only(root: &Path, paths: &[PathBuf]) -> bool {
    let event = paths
        .iter()
        .fold(Event::new(EventKind::Any), |event, path| {
            event.add_path(path.clone())
        });
    watch::metadata_only(root, &[DebouncedEvent::new(event, Instant::now())])
}
struct MetadataWatchFixture {
    dir: TempDir,
    handle: Repository,
    second_patch: String,
    before: Arc<gitviewer_lib::status::Status>,
}
async fn prepare_metadata_watch_fixture() -> MetadataWatchFixture {
    let (dir, handle) = fixture().await;
    let root = dir.path().to_path_buf();
    let body = numbered("line ", 30);
    base(&handle).await;
    record(
        &handle,
        Recorded {
            path: "two.txt",
            body: &body,
            message: "Three hunks",
        },
    )
    .await;
    std::fs::write(
        root.join("two.txt"),
        body.replace("line 1\n", "first\n")
            .replace("line 15\n", "middle\n")
            .replace("line 28\n", "last\n"),
    )
    .unwrap();
    std::fs::write(root.join("added.sh"), "echo\n").unwrap();
    command(&root, &["add", "added.sh"]).await;
    handle.refresh().await.unwrap();
    let hunks = read_diff(&handle, DiffRef::working("two.txt", DiffSource::Unstaged))
        .await
        .unwrap();
    assert_eq!(hunks.hunks.len(), 3);
    let first = diff::patch("two.txt", &hunks.hunks[0]).unwrap();
    diff::apply_hunk(
        &handle,
        HunkRequest {
            path: "two.txt",
            source: DiffSource::Unstaged,
            hunk: 0,
            expected: &first,
            action: "stage",
        },
    )
    .await
    .unwrap();
    let remaining = read_diff(&handle, DiffRef::working("two.txt", DiffSource::Unstaged))
        .await
        .unwrap();
    let second_patch = diff::patch("two.txt", &remaining.hunks[0]).unwrap();
    touch_in_future(&root.join("file.txt"));
    let before = handle.refresh().await.unwrap();
    assert_eq!(before.entries.len(), 2);
    MetadataWatchFixture {
        dir,
        handle,
        second_patch,
        before,
    }
}
#[tokio::test]
async fn metadata_batches_notify_only_when_the_snapshot_changes() {
    let fixture = prepare_metadata_watch_fixture().await;
    let root = fixture.dir.path().to_path_buf();
    let handle = &fixture.handle;
    let trace = trace_file(&fixture.dir, "echo-trace");
    std::env::set_var("GIT_TRACE2_EVENT", &trace);
    let changes = Arc::new(Mutex::new(Vec::new()));
    let captured = changes.clone();
    watch::start(handle, move |change| captured.lock().unwrap().push(change)).unwrap();
    let index = std::fs::read(root.join(".git").join("index")).unwrap();
    let from = trace_size(&trace);
    git::run(&root, &["update-index", "-q", "--refresh"], None)
        .await
        .unwrap();
    assert_ne!(
        std::fs::read(root.join(".git").join("index")).unwrap(),
        index
    );
    poll_until(
        Polling {
            limit: Duration::from_secs(4),
            period: Duration::from_millis(100),
        },
        || launched(&trace, from, "status") != 0 && exits(&trace, from) != 0,
        no_nudge,
    )
    .await;
    confirm_quiet(
        Polling {
            limit: Duration::from_millis(500),
            period: Duration::from_millis(50),
        },
        || !changes.lock().unwrap().is_empty(),
    )
    .await;
    assert_eq!(handle.snapshot().await.unwrap(), fixture.before);
    git::run(
        &root,
        &["apply", "--cached"],
        Some(fixture.second_patch.as_bytes()),
    )
    .await
    .unwrap()
    .accept(&[0])
    .unwrap();
    arrives(&changes, &Change::Status, no_nudge).await;
    let restaged = handle.snapshot().await.unwrap();
    assert_ne!(restaged, fixture.before);
    assert_eq!(
        serde_json::to_value(&restaged).unwrap(),
        serde_json::to_value(&fixture.before).unwrap()
    );
    changes.lock().unwrap().clear();
    command(&root, &["update-index", "--chmod=+x", "added.sh"]).await;
    arrives(&changes, &Change::Status, no_nudge).await;
    changes.lock().unwrap().clear();
    command(&root, &["branch", "created"]).await;
    arrives(&changes, &Change::Head, no_nudge).await;
    std::env::remove_var("GIT_TRACE2_EVENT");
    std::fs::remove_file(&trace).ok();
}
#[tokio::test]
async fn metadata_only_identifies_git_directory_batches() {
    let (dir, _handle) = fixture().await;
    let root = dir.path();
    assert!(repository_only(root, &[root.join(".git")]));
    assert!(repository_only(
        root,
        &[root.join(".git"), root.join(".git")]
    ));
    assert!(!repository_only(
        root,
        &[root.join(".git"), root.join("file.txt")]
    ));
    assert!(!repository_only(root, &[root.join(".git").join("index")]));
    assert!(!watch::metadata_only(root, &[]));
}
#[tokio::test]
async fn a_dropped_repository_is_released_by_its_watchers() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let changes = Arc::new(Mutex::new(Vec::new()));
    let captured = changes.clone();
    watch::start(&handle, move |change| captured.lock().unwrap().push(change)).unwrap();
    let released = Arc::downgrade(&handle);
    drop(handle);
    assert!(released.upgrade().is_none());
    command(dir.path(), &["branch", "after-close"]).await;
    std::fs::write(dir.path().join("file.txt"), "changed\n").unwrap();
    confirm_quiet(
        Polling {
            limit: Duration::from_millis(1500),
            period: Duration::from_millis(50),
        },
        || !changes.lock().unwrap().is_empty(),
    )
    .await;
}
#[tokio::test]
async fn history_sessions_keep_only_the_latest_page() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let root = dir.path();
    let tree = command(root, &["rev-parse", "HEAD^{tree}"]).await;
    let parent = append_commit_chain(root, 210, "commit").await;
    handle.refresh().await.unwrap();
    let first = history::page(&handle, "", "").await.unwrap();
    let cursor = first.cursor.clone().unwrap();
    let second = history::page(&handle, &cursor, "").await.unwrap();
    let repeated = history::page(&handle, &cursor, "").await.unwrap();
    let hashes = |page: &history::Page| {
        page.commits
            .iter()
            .map(|commit| commit.hash.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(hashes(&repeated), hashes(&second));
    let third = history::page(&handle, second.cursor.as_deref().unwrap(), "")
        .await
        .unwrap();
    assert_eq!(third.commits.len(), 11);
    assert!(third.cursor.is_none());
    assert_eq!(
        history::page(&handle, &cursor, "")
            .await
            .unwrap_err()
            .message,
        "History changed; reload from the first page"
    );
    let newest = git::run(
        root,
        &["commit-tree", tree.trim(), "-p", &parent],
        Some(b"newest\n"),
    )
    .await
    .unwrap()
    .text();
    command(root, &["update-ref", "refs/heads/main", newest.trim()]).await;
    let restarted = history::page(&handle, "", "").await.unwrap();
    assert_eq!(restarted.commits[0].hash, newest.trim());
    assert_eq!(restarted.commits[1].hash, first.commits[0].hash);
    assert_eq!(
        history::page(&handle, second.cursor.as_deref().unwrap(), "")
            .await
            .unwrap_err()
            .message,
        "History changed; reload from the first page"
    );
}
#[tokio::test]
async fn concurrent_opens_of_one_path_share_one_registry_entry() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let registry = Registry::default();
    let path = dir.path().to_str().unwrap();
    let nested = dir.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    let (first, second, inner) = tokio::join!(
        registry.open(path),
        registry.open(path),
        registry.open(nested.to_str().unwrap())
    );
    let (first, second, inner) = (first.unwrap(), second.unwrap(), inner.unwrap());
    assert_eq!(registry.repos.lock().await.len(), 1);
    assert_eq!(first.id, second.id);
    assert_eq!(first.id, inner.id);
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(&second).unwrap()
    );
    let other = fixture().await.0;
    registry.open(other.path().to_str().unwrap()).await.unwrap();
    assert_eq!(registry.repos.lock().await.len(), 2);
}
