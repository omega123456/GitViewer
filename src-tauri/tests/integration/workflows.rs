use gitviewer_lib::{
    actions, ai, branch, diff, git, history,
    repo::{Registry, Repository},
    stash, tree, watch,
};
use serde_json::json;
use std::time::Duration;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tempfile::TempDir;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, ResponseTemplate,
};

pub(super) fn silent() -> impl Fn(&str) {
    |_| {}
}
pub(super) async fn command(root: &Path, args: &[&str]) -> String {
    git::text(root, args).await.unwrap()
}
pub(super) async fn fixture() -> (TempDir, Repository) {
    let dir = tempfile::tempdir().unwrap();
    command(dir.path(), &["init", "--initial-branch=main"]).await;
    command(dir.path(), &["config", "user.name", "Fixture Author"]).await;
    command(
        dir.path(),
        &["config", "user.email", "fixture@example.invalid"],
    )
    .await;
    command(dir.path(), &["config", "core.autocrlf", "false"]).await;
    let registry = Registry::default();
    let info = registry.open(dir.path().to_str().unwrap()).await.unwrap();
    let repo = registry.get(&info.id).await.unwrap();
    (dir, repo)
}
pub(super) async fn base(dir: &TempDir, repo: &Repository) {
    std::fs::write(dir.path().join("file.txt"), "one\ntwo\nthree\n").unwrap();
    let mut repo = repo.lock().await;
    actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "Initial").await.unwrap();
}
#[tokio::test]
async fn staging_commit_lazy_tree_and_plain_reads() {
    let (dir, handle) = fixture().await;
    let mut repo = handle.lock().await;
    assert!(history::page(&mut repo, "", "")
        .await
        .unwrap()
        .commits
        .is_empty());
    assert!(actions::commit(&mut repo, "").await.is_err());
    assert!(actions::commit(&mut repo, "empty").await.is_err());
    std::fs::create_dir(dir.path().join("ignored")).unwrap();
    std::fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
    std::fs::write(dir.path().join("ignored/secret"), "local").unwrap();
    std::fs::write(dir.path().join("file name\t.txt"), "hello\n").unwrap();
    repo.refresh().await.unwrap();
    let files = tree::list(&mut repo, "").await.unwrap();
    assert_eq!(files.len(), 3);
    assert!(files[0].directory);
    assert!(files[0].ignored);
    assert_eq!(tree::list(&mut repo, "ignored").await.unwrap().len(), 1);
    let plain = diff::read(&repo, "ignored/secret", "file", "", 3, false)
        .await
        .unwrap();
    assert_eq!(plain.content.as_deref(), Some("local"));
    actions::files(&mut repo, &["file name\t.txt".into()], "stage")
        .await
        .unwrap();
    actions::files(&mut repo, &["file name\t.txt".into()], "unstage")
        .await
        .unwrap();
    actions::files(
        &mut repo,
        &["file name\t.txt".into(), ".gitignore".into()],
        "stage",
    )
    .await
    .unwrap();
    actions::commit(&mut repo, "first").await.unwrap();
    repo.refresh().await.unwrap();
    assert_eq!(
        history::page(&mut repo, "", "").await.unwrap().commits[0].subject,
        "first"
    );
    assert!(actions::files(&mut repo, &[], "stage").await.is_err());
    assert!(actions::files(&mut repo, &["../outside".into()], "stage")
        .await
        .is_err());
    assert!(
        actions::files(&mut repo, &[".git/config".into()], "discard")
            .await
            .is_err()
    );
    assert!(repo.path("/absolute").is_err());
    assert!(
        actions::files(&mut repo, &["ignored/secret".into()], "stage")
            .await
            .is_err()
    );
}
#[tokio::test]
async fn hunk_stage_unstage_discard_and_staleness() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    std::fs::write(dir.path().join("file.txt"), "one\nchanged\nthree").unwrap();
    let mut repo = handle.lock().await;
    repo.refresh().await.unwrap();
    let d = diff::read(&repo, "file.txt", "unstaged", "", 3, false)
        .await
        .unwrap();
    assert!(d.hunks[0].lines.last().unwrap().no_newline);
    assert!(
        diff::apply_hunk(&mut repo, "file.txt", "unstaged", 0, 3, "outdated", "stage")
            .await
            .is_err()
    );
    let patch = diff::patch("file.txt", &d.hunks[0]).unwrap();
    diff::apply_hunk(&mut repo, "file.txt", "unstaged", 0, 3, &patch, "stage")
        .await
        .unwrap();
    repo.refresh().await.unwrap();
    let staged = diff::read(&repo, "file.txt", "staged", "", 3, false)
        .await
        .unwrap();
    let patch = diff::patch("file.txt", &staged.hunks[0]).unwrap();
    diff::apply_hunk(&mut repo, "file.txt", "staged", 0, 3, &patch, "unstage")
        .await
        .unwrap();
    diff::apply_hunk(&mut repo, "file.txt", "unstaged", 0, 3, &patch, "discard")
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "one\ntwo\nthree\n"
    );
    assert!(
        diff::apply_hunk(&mut repo, "file.txt", "commit", 0, 3, "", "stage")
            .await
            .is_err()
    );
}
#[tokio::test]
async fn branches_history_blame_stashes_and_checkout_rollback() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let mut repo = handle.lock().await;
    branch::create(&mut repo, "other", "HEAD").await.unwrap();
    branch::switch(&mut repo, "other").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "branch version\n").unwrap();
    actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "other commit").await.unwrap();
    branch::switch(&mut repo, "main").await.unwrap();
    assert!(branch::delete(&mut repo, "other").await.is_err());
    std::fs::write(dir.path().join("file.txt"), "local version\n").unwrap();
    let before = repo.refresh().await.unwrap();
    assert!(branch::switch(&mut repo, "other").await.is_err());
    assert!(stash::smart_checkout(&mut repo, "other").await.is_err());
    let after = repo.refresh().await.unwrap();
    assert_eq!(after.branch, "main");
    assert_eq!(before.entries, after.entries);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "local version\n"
    );
    assert!(stash::list(&repo).await.unwrap().is_empty());
    let sha = stash::save(&mut repo, "local experiment").await.unwrap();
    branch::switch(&mut repo, "other").await.unwrap();
    assert!(stash::apply(&mut repo, &sha, false, false).await.is_err());
    assert!(repo.refresh().await.unwrap().entries.is_empty());
    assert_eq!(stash::list(&repo).await.unwrap().len(), 1);
    branch::switch(&mut repo, "main").await.unwrap();
    stash::apply(&mut repo, &sha, true, false).await.unwrap();
    assert!(stash::list(&repo).await.unwrap().is_empty());
    actions::files(&mut repo, &["file.txt".into()], "discard")
        .await
        .unwrap();
    assert_eq!(history::blame(&repo, "file.txt").await.unwrap().len(), 3);
    assert!(history::blame(&repo, "untracked").await.unwrap().is_empty());
    let commits = history::page(&mut repo, "", "file.txt").await.unwrap();
    assert_eq!(
        history::files(&repo, &commits.commits[0].hash)
            .await
            .unwrap(),
        vec!["file.txt"]
    );
    let d = diff::read(
        &repo,
        "file.txt",
        "commit",
        &commits.commits[0].hash,
        3,
        false,
    )
    .await
    .unwrap();
    assert!(!d.hunks.is_empty());
    branch::create(&mut repo, "temporary", "HEAD")
        .await
        .unwrap();
    branch::delete(&mut repo, "temporary").await.unwrap();
    assert!(branch::switch(&mut repo, "missing").await.is_err());
}
#[tokio::test]
async fn smart_apply_combines_disjoint_work_and_hashes_survive_renumbering() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let mut repo = handle.lock().await;
    std::fs::write(dir.path().join("file.txt"), "stashed\n").unwrap();
    let target = stash::save(&mut repo, "target").await.unwrap();
    std::fs::write(dir.path().join("new.txt"), "new untracked\n").unwrap();
    stash::apply(&mut repo, &target, true, true).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "stashed\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("new.txt")).unwrap(),
        "new untracked\n"
    );
    assert!(stash::list(&repo).await.unwrap().is_empty());
    let target = stash::save(&mut repo, "target").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "overlap\n").unwrap();
    assert!(stash::apply(&mut repo, &target, false, true)
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
    watch::start(&mut *handle.lock().await, move |_| {
        captured.fetch_add(1, Ordering::SeqCst);
    })
    .unwrap();
    std::fs::write(dir.path().join("new.txt"), "new").unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(4), async {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
        while hits.load(Ordering::SeqCst) == 0 {
            interval.tick().await;
            std::fs::write(dir.path().join("new.txt"), "new").unwrap();
        }
    })
    .await
    .unwrap();
    let mut repo = handle.lock().await;
    assert_eq!(repo.snapshot().await.unwrap().entries.len(), 1);
}

#[tokio::test]
async fn local_remote_fetch_pull_push_and_divergence_refusal() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let remote = tempfile::tempdir().unwrap();
    command(remote.path(), &["init", "--bare", "--initial-branch=main"]).await;
    command(
        dir.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    )
    .await;
    command(dir.path(), &["push", "-u", "origin", "main"]).await;
    let (other, other_handle) = fixture().await;
    command(
        other.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    )
    .await;
    command(other.path(), &["fetch", "origin"]).await;
    command(other.path(), &["checkout", "-B", "main", "origin/main"]).await;
    std::fs::write(other.path().join("remote.txt"), "remote\n").unwrap();
    {
        let mut repo = other_handle.lock().await;
        actions::files(&mut repo, &["remote.txt".into()], "stage")
            .await
            .unwrap();
        actions::commit(&mut repo, "Remote change").await.unwrap();
        branch::sync(&mut repo, "push", silent()).await.unwrap();
    }
    let mut repo = handle.lock().await;
    let reported = Arc::new(Mutex::new(Vec::<String>::new()));
    let collector = reported.clone();
    branch::sync(&mut repo, "fetch", move |line| {
        collector.lock().unwrap().push(line.into())
    })
    .await
    .unwrap();
    assert!(!reported.lock().unwrap().is_empty());
    assert_eq!(repo.refresh().await.unwrap().behind, Some(1));
    std::fs::write(dir.path().join("file.txt"), "one\ntwo\ndirty\n").unwrap();
    std::fs::write(dir.path().join("untracked.txt"), "untracked\n").unwrap();
    repo.refresh().await.unwrap();
    branch::sync(&mut repo, "pull", silent()).await.unwrap();
    assert!(dir.path().join("remote.txt").exists());
    assert!(dir.path().join("untracked.txt").exists());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "one\ntwo\ndirty\n"
    );
    actions::files(&mut repo, &["file.txt".into()], "discard")
        .await
        .unwrap();
    std::fs::remove_file(dir.path().join("untracked.txt")).unwrap();
    repo.refresh().await.unwrap();
    branch::sync(&mut repo, "push", silent()).await.unwrap();
    branch::create(&mut repo, "merged", "HEAD").await.unwrap();
    command(dir.path(), &["push", "origin", "merged"]).await;
    branch::delete(&mut repo, "origin/merged").await.unwrap();
    std::fs::write(dir.path().join("local.txt"), "local\n").unwrap();
    actions::files(&mut repo, &["local.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "Local change").await.unwrap();
    {
        let mut other_repo = other_handle.lock().await;
        std::fs::write(other.path().join("another.txt"), "another\n").unwrap();
        actions::files(&mut other_repo, &["another.txt".into()], "stage")
            .await
            .unwrap();
        actions::commit(&mut other_repo, "Divergence")
            .await
            .unwrap();
        branch::sync(&mut other_repo, "push", silent())
            .await
            .unwrap();
    }
    assert!(branch::sync(&mut repo, "pull", silent())
        .await
        .unwrap_err()
        .message
        .contains("cannot fast-forward"));
    assert!(repo.refresh().await.unwrap().entries.is_empty());
    assert!(branch::sync(&mut repo, "invalid", silent()).await.is_err());
    command(dir.path(), &["checkout", "--detach"]).await;
    assert!(branch::sync(&mut repo, "push", silent())
        .await
        .unwrap_err()
        .message
        .contains("Detached"));
    command(
        dir.path(),
        &[
            "remote",
            "set-url",
            "origin",
            "https://example.invalid/no-network-test",
        ],
    )
    .await;
    assert!(branch::sync(&mut repo, "fetch", silent())
        .await
        .unwrap_err()
        .message
        .contains("fixture remotes"));
}

#[tokio::test]
async fn history_cursor_preserves_merge_frontier_and_cached_pages() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    command(dir.path(), &["branch", "side"]).await;
    let tree = command(dir.path(), &["rev-parse", "HEAD^{tree}"]).await;
    let mut parent = command(dir.path(), &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_string();
    for i in 0..110 {
        parent = git::run(
            dir.path(),
            &["commit-tree", tree.trim(), "-p", &parent],
            Some(format!("main {i}\n").as_bytes()),
        )
        .await
        .unwrap()
        .accept(&[0])
        .unwrap()
        .text()
        .trim()
        .into();
    }
    command(dir.path(), &["update-ref", "refs/heads/main", &parent]).await;
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
    let expected = command(dir.path(), &["rev-list", "--topo-order", "HEAD"]).await;
    let mut repo = handle.lock().await;
    repo.refresh().await.unwrap();
    let first = history::page(&mut repo, "", "").await.unwrap();
    assert_eq!(first.commits.len(), 100);
    std::fs::write(dir.path().join("untracked.txt"), "local edit").unwrap();
    repo.stale.store(true, Ordering::SeqCst);
    repo.snapshot().await.unwrap();
    assert!(!repo.histories.is_empty());
    let second = history::page(&mut repo, first.cursor.as_deref().unwrap(), "")
        .await
        .unwrap();
    let hashes: Vec<&str> = first
        .commits
        .iter()
        .chain(&second.commits)
        .map(|c| c.hash.as_str())
        .collect();
    assert_eq!(hashes, expected.lines().collect::<Vec<_>>());
    assert_eq!(
        history::page(&mut repo, "", "").await.unwrap().commits[0].hash,
        first.commits[0].hash
    );
    assert!(history::page(&mut repo, "invalid", "").await.is_err());
    assert!(history::page(&mut repo, "expired", "file.txt")
        .await
        .is_err());
}

#[tokio::test]
async fn file_limits_binary_missing_and_conflicted_guards() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let mut repo = handle.lock().await;
    std::fs::write(dir.path().join("binary.bin"), b"a\0b").unwrap();
    assert!(
        diff::read(&repo, "binary.bin", "file", "", 3, false)
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
        diff::read(&repo, "large.txt", "file", "", 3, false)
            .await
            .unwrap()
            .too_large
    );
    assert!(
        !diff::read(&repo, "large.txt", "file", "", 3, true)
            .await
            .unwrap()
            .too_large
    );
    assert_eq!(
        diff::read(&repo, "missing", "file", "", 3, false)
            .await
            .unwrap()
            .content
            .as_deref(),
        Some("")
    );
    assert!(diff::read(&repo, "file.txt", "invalid", "", 3, false)
        .await
        .is_err());
    assert!(diff::resolve(&repo, "not-a-revision").await.is_err());
    assert!(tree::list(&mut repo, "missing").await.is_err());
    std::fs::create_dir(dir.path().join("empty")).unwrap();
    assert!(tree::list(&mut repo, "empty").await.unwrap().is_empty());
    assert!(actions::files(&mut repo, &["binary.bin".into()], "discard")
        .await
        .is_err());
    assert!(actions::files(&mut repo, &["file.txt".into()], "invalid")
        .await
        .is_err());
    assert!(stash::drop(&mut repo, "missing").await.is_err());
    assert!(stash::apply(&mut repo, "missing", false, false)
        .await
        .is_err());
    assert!(branch::delete(&mut repo, "main").await.is_err());
    assert!(branch::delete(&mut repo, "missing").await.is_err());
}

#[tokio::test]
async fn rename_hunks_preserve_identity_and_file_unstage_restores_both_paths() {
    let (dir, handle) = fixture().await;
    let content = (0..80)
        .map(|line| format!("line {line}\n"))
        .collect::<String>();
    std::fs::write(dir.path().join("original.txt"), &content).unwrap();
    let mut repo = handle.lock().await;
    actions::files(&mut repo, &["original.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "Original").await.unwrap();
    command(dir.path(), &["mv", "original.txt", "renamed.txt"]).await;
    let changed = content.replace("line 20\n", "changed 20\n");
    std::fs::write(dir.path().join("renamed.txt"), &changed).unwrap();
    actions::files(&mut repo, &["renamed.txt".into()], "stage")
        .await
        .unwrap();
    repo.refresh().await.unwrap();
    let staged = diff::read(&repo, "renamed.txt", "staged", "", 3, false)
        .await
        .unwrap();
    assert_eq!(staged.hunks.len(), 1);
    let patch = diff::patch("renamed.txt", &staged.hunks[0]).unwrap();
    diff::apply_hunk(&mut repo, "renamed.txt", "staged", 0, 3, &patch, "unstage")
        .await
        .unwrap();
    let status = repo.refresh().await.unwrap();
    assert_eq!(status.entries[0].index(), "R");
    assert_eq!(status.entries[0].worktree(), "M");
    assert_eq!(
        diff::bytes(&repo, "renamed.txt", "unstaged", "", true)
            .await
            .unwrap(),
        content.as_bytes()
    );
    actions::files(&mut repo, &["renamed.txt".into()], "unstage")
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
    let (dir, handle) = fixture().await;
    let original = (0..100)
        .map(|line| format!("line {line}\n"))
        .collect::<String>();
    std::fs::write(dir.path().join("file.txt"), &original).unwrap();
    let mut repo = handle.lock().await;
    actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "Base").await.unwrap();
    let changed = original
        .replace("line 10\n", "ten\n")
        .replace("line 50\n", "fifty\n")
        .replace("line 90\n", "ninety\n");
    std::fs::write(dir.path().join("file.txt"), &changed).unwrap();
    let result = diff::read(&repo, "file.txt", "unstaged", "", 3, false)
        .await
        .unwrap();
    assert_eq!(result.hunks.len(), 3);
    let patch = diff::patch("file.txt", &result.hunks[1]).unwrap();
    diff::apply_hunk(&mut repo, "file.txt", "unstaged", 1, 3, &patch, "stage")
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
    assert!(
        diff::apply_hunk(&mut repo, "file.txt", "unstaged", 99, 3, "", "stage")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn stash_untracked_contents_and_safe_checkout_preserve_staged_work() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let mut repo = handle.lock().await;
    branch::create(&mut repo, "other", "HEAD").await.unwrap();
    std::fs::write(dir.path().join("new.txt"), "untracked content").unwrap();
    std::fs::write(dir.path().join("file.txt"), "staged content\n").unwrap();
    actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .unwrap();
    let hash = stash::save(&mut repo, "With untracked").await.unwrap();
    let result = diff::read(&repo, "new.txt", "stash", &hash, 3, false)
        .await
        .unwrap();
    assert_eq!(result.content.as_deref(), Some("untracked content"));
    assert!(
        diff::read(&repo, "file.txt", "stash", &hash, 3, false)
            .await
            .unwrap()
            .hunks
            .len()
            == 1
    );
    std::fs::write(dir.path().join("new.txt"), "existing content").unwrap();
    assert!(stash::precheck(&repo, &hash)
        .await
        .unwrap_err()
        .message
        .contains("untracked path"));
    std::fs::remove_file(dir.path().join("new.txt")).unwrap();
    stash::apply(&mut repo, &hash, true, false).await.unwrap();
    stash::smart_checkout(&mut repo, "other").await.unwrap();
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
    let hash = stash::save(&mut repo, "Again").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "dirty").unwrap();
    assert_eq!(
        stash::apply(&mut repo, &hash, false, false)
            .await
            .unwrap_err()
            .category,
        "smart_apply"
    );
}

#[tokio::test]
async fn conflicted_repository_refuses_writes_and_literal_paths_do_not_expand() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let mut repo = handle.lock().await;
    branch::create(&mut repo, "other", "HEAD").await.unwrap();
    branch::switch(&mut repo, "other").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "other\n").unwrap();
    actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "Other").await.unwrap();
    branch::switch(&mut repo, "main").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), "main\n").unwrap();
    actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "Main").await.unwrap();
    assert_eq!(
        git::run(dir.path(), &["merge", "other"], None)
            .await
            .unwrap()
            .code,
        1
    );
    assert!(repo.refresh().await.unwrap().conflicted);
    assert!(actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .is_err());
    assert!(branch::sync(&mut repo, "fetch", silent()).await.is_err());
    assert!(stash::save(&mut repo, "conflict").await.is_err());
    command(dir.path(), &["merge", "--abort"]).await;
    std::fs::write(dir.path().join("[literal].txt"), "literal").unwrap();
    std::fs::write(dir.path().join("l.txt"), "other").unwrap();
    actions::files(&mut repo, &["[literal].txt".into()], "stage")
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
        for file in 0..500 {
            std::fs::write(folder.join(format!("{file}.txt")), "").unwrap();
        }
    }
    let mut repo = handle.lock().await;
    assert_eq!(repo.directory_reads, 0);
    assert_eq!(tree::list(&mut repo, "").await.unwrap().len(), 2);
    assert_eq!(repo.directory_reads, 1);
    assert_eq!(tree::list(&mut repo, "generated").await.unwrap().len(), 100);
    assert_eq!(
        tree::list(&mut repo, "generated/0").await.unwrap().len(),
        500
    );
    assert_eq!(repo.directory_reads, 3);
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
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let mut repo = handle.lock().await;
    assert!(branch::sync(&mut repo, "pull", silent())
        .await
        .unwrap_err()
        .message
        .contains("No upstream"));
    repo.root = dir.path().join("missing");
    assert!(watch::start(&mut repo, |_| {}).is_err());
}

#[tokio::test]
async fn remote_checkout_creates_tracking_branches_and_never_detaches() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let remote = tempfile::tempdir().unwrap();
    command(remote.path(), &["init", "--bare", "--initial-branch=main"]).await;
    command(
        dir.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    )
    .await;
    command(dir.path(), &["push", "origin", "main:feature"]).await;
    let mut repo = handle.lock().await;
    branch::switch(&mut repo, "origin/feature").await.unwrap();
    let status = repo.refresh().await.unwrap();
    assert_eq!(status.branch, "feature");
    assert_eq!(status.upstream.as_deref(), Some("origin/feature"));
    branch::switch(&mut repo, "main").await.unwrap();
    branch::switch(&mut repo, "origin/feature").await.unwrap();
    assert_eq!(repo.refresh().await.unwrap().branch, "feature");
    command(dir.path(), &["branch", "--unset-upstream"]).await;
    branch::switch(&mut repo, "main").await.unwrap();
    assert!(branch::switch(&mut repo, "origin/feature")
        .await
        .unwrap_err()
        .message
        .contains("different reference"));
    branch::switch(&mut repo, "feature").await.unwrap();
    std::fs::write(dir.path().join("feature.txt"), "feature").unwrap();
    actions::files(&mut repo, &["feature.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "Feature").await.unwrap();
    command(dir.path(), &["push", "origin", "feature"]).await;
    branch::switch(&mut repo, "main").await.unwrap();
    assert!(branch::delete(&mut repo, "origin/feature")
        .await
        .unwrap_err()
        .message
        .contains("not fully merged"));
}

#[tokio::test]
async fn expanded_context_hunks_stage_unstage_and_discard_exactly_the_displayed_change() {
    let (dir, handle) = fixture().await;
    let original = (0..200)
        .map(|line| format!("line {line}\n"))
        .collect::<String>();
    std::fs::write(dir.path().join("file.txt"), &original).unwrap();
    let mut repo = handle.lock().await;
    actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "Base").await.unwrap();
    let changed = original
        .replace("line 40\n", "forty\n")
        .replace("line 150\n", "one fifty\n");
    std::fs::write(dir.path().join("file.txt"), &changed).unwrap();
    for (source, action) in [
        ("unstaged", "stage"),
        ("staged", "unstage"),
        ("unstaged", "discard"),
    ] {
        let result = diff::read(&repo, "file.txt", source, "", 30, false)
            .await
            .unwrap();
        let patch = diff::patch("file.txt", &result.hunks[0]).unwrap();
        diff::apply_hunk(&mut repo, "file.txt", source, 0, 30, &patch, action)
            .await
            .unwrap();
        let indexed = command(dir.path(), &["show", ":file.txt"]).await;
        assert_eq!(
            indexed,
            if action == "stage" {
                original.replace("line 40\n", "forty\n")
            } else {
                original.clone()
            }
        );
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        original.replace("line 150\n", "one fifty\n")
    );
}

#[tokio::test]
async fn plain_text_line_limit_and_image_ceiling_apply_before_rendering() {
    let (dir, handle) = fixture().await;
    let repo = handle.lock().await;
    std::fs::write(dir.path().join("many.txt"), "x\n".repeat(50001)).unwrap();
    let limited = diff::read(&repo, "many.txt", "file", "", 3, false)
        .await
        .unwrap();
    assert!(limited.too_large);
    assert!(limited.content.is_none());
    let expanded = diff::read(&repo, "many.txt", "file", "", 3, true)
        .await
        .unwrap();
    assert_eq!(expanded.content.unwrap().lines().count(), 50001);
    let image = std::fs::File::create(dir.path().join("large.png")).unwrap();
    image.set_len(20 * 1024 * 1024 + 1).unwrap();
    assert!(
        diff::read(&repo, "large.png", "file", "", 3, true)
            .await
            .unwrap()
            .too_large
    );
}

#[tokio::test]
async fn unborn_unstage_preserves_further_working_tree_edits() {
    let (dir, handle) = fixture().await;
    let mut repo = handle.lock().await;
    std::fs::write(dir.path().join("new.txt"), "staged\n").unwrap();
    actions::files(&mut repo, &["new.txt".into()], "stage")
        .await
        .unwrap();
    std::fs::write(dir.path().join("new.txt"), "further edits\n").unwrap();
    actions::files(&mut repo, &["new.txt".into()], "unstage")
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
    let (dir, handle) = fixture().await;
    let mut repo = handle.lock().await;
    let original = "one\r\ntwo\r\nthree\r\n";
    let changed = "one\r\nchanged\r\nthree\r\n";
    std::fs::write(dir.path().join("file.txt"), original).unwrap();
    actions::files(&mut repo, &["file.txt".into()], "stage")
        .await
        .unwrap();
    actions::commit(&mut repo, "CRLF base").await.unwrap();
    std::fs::write(dir.path().join("file.txt"), changed).unwrap();
    for (source, action) in [
        ("unstaged", "stage"),
        ("staged", "unstage"),
        ("unstaged", "discard"),
    ] {
        let result = diff::read(&repo, "file.txt", source, "", 3, false)
            .await
            .unwrap();
        let patch = diff::patch("file.txt", &result.hunks[0]).unwrap();
        diff::apply_hunk(&mut repo, "file.txt", source, 0, 3, &patch, action)
            .await
            .unwrap();
        assert_eq!(
            command(dir.path(), &["show", ":file.txt"]).await,
            if action == "stage" { changed } else { original }
        );
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        original
    );
}

#[tokio::test]
async fn revert_all_restores_staged_unstaged_renamed_and_new_files() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    command(dir.path(), &["mv", "file.txt", "renamed.txt"]).await;
    std::fs::write(dir.path().join("renamed.txt"), "changed").unwrap();
    std::fs::write(dir.path().join("added.txt"), "added").unwrap();
    command(dir.path(), &["add", "added.txt"]).await;
    std::fs::write(dir.path().join("untracked.txt"), "new").unwrap();
    let mut repo = handle.lock().await;
    repo.refresh().await.unwrap();
    let paths = repo
        .status
        .entries
        .iter()
        .map(|entry| entry.path().to_owned())
        .collect::<Vec<_>>();
    actions::files(&mut repo, &paths, "revert").await.unwrap();
    repo.refresh().await.unwrap();
    assert!(repo.status.entries.is_empty());
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
    let mut repo = handle.lock().await;
    repo.refresh().await.unwrap();
    actions::files(&mut repo, &["added.txt".into()], "revert")
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
        " small ",
        "Describe it.",
        ai::Material {
            source: ai::Source::WorkingTree,
            detail: ai::Detail::Summary,
            ..sample()
        },
    )
    .await
    .unwrap();
    assert_eq!(draft.message.chars().count(), ai::MESSAGE_CAP);
    assert_eq!(draft.source, ai::Source::WorkingTree);
    assert_eq!(draft.detail, ai::Detail::Summary);
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
    let guard = handle.lock().await;
    let draft = ai::draft(
        &endpoint(
            &format!("{}/v1", server.uri()),
            "key",
            Duration::from_secs(5),
        ),
        "small",
        "Describe it.",
        sample(),
    )
    .await
    .unwrap();
    assert_eq!(draft.message, "Add the thing");
    assert!(guard.root.exists());
}

#[tokio::test]
async fn ai_refuses_an_unconfigured_endpoint_and_maps_endpoint_failures() {
    let short = Duration::from_millis(80);
    assert_eq!(
        ai::draft(&endpoint("", "key", short), "small", "t", sample())
            .await
            .unwrap_err()
            .message,
        "No endpoint is configured"
    );
    assert_eq!(
        ai::models(&endpoint("https://example.invalid", "", short))
            .await
            .unwrap_err()
            .message,
        "No API key is stored"
    );
    assert_eq!(
        ai::draft(
            &endpoint("https://example.invalid", "key", short),
            "  ",
            "t",
            sample()
        )
        .await
        .unwrap_err()
        .message,
        "No model is configured"
    );

    let rejecting = MockServer::start().await;
    completion(
        &rejecting,
        ResponseTemplate::new(401).set_body_json(json!({"error": {"message": "bad key"}})),
    )
    .await;
    let rejected = ai::draft(
        &endpoint(&format!("{}/v1", rejecting.uri()), "key", short),
        "small",
        "t",
        sample(),
    )
    .await
    .unwrap_err();
    assert_eq!(rejected.category, "authentication");
    assert_eq!(rejected.message, "The endpoint rejected the API key");

    let failing = MockServer::start().await;
    completion(
        &failing,
        ResponseTemplate::new(500).set_body_string("upstream exploded"),
    )
    .await;
    let refused = ai::draft(
        &endpoint(&format!("{}/v1", failing.uri()), "key", short),
        "small",
        "t",
        sample(),
    )
    .await
    .unwrap_err();
    assert_eq!(refused.category, "refused");
    assert_eq!(
        refused.message,
        "The endpoint refused the request with status 500"
    );
    assert!(!refused.message.contains("upstream exploded"));

    let malformed = MockServer::start().await;
    completion(
        &malformed,
        ResponseTemplate::new(200).set_body_json(json!({"unexpected": true})),
    )
    .await;
    assert_eq!(
        ai::draft(
            &endpoint(&format!("{}/v1", malformed.uri()), "key", short),
            "small",
            "t",
            sample()
        )
        .await
        .unwrap_err()
        .message,
        "The endpoint returned a response the application could not read"
    );

    let empty = MockServer::start().await;
    completion(
        &empty,
        ResponseTemplate::new(200).set_body_json(json!({
            "id": "one",
            "object": "chat.completion",
            "created": 0,
            "model": "small",
            "choices": []
        })),
    )
    .await;
    assert_eq!(
        ai::draft(
            &endpoint(&format!("{}/v1", empty.uri()), "key", short),
            "small",
            "t",
            sample()
        )
        .await
        .unwrap_err()
        .message,
        "The endpoint returned no message"
    );

    let blank = MockServer::start().await;
    completion(
        &blank,
        ResponseTemplate::new(200).set_body_json(json!({
            "id": "one",
            "object": "chat.completion",
            "created": 0,
            "model": "small",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "   "}
            }]
        })),
    )
    .await;
    assert_eq!(
        ai::draft(
            &endpoint(&format!("{}/v1", blank.uri()), "key", short),
            "small",
            "t",
            sample()
        )
        .await
        .unwrap_err()
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
        "small",
        "t",
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
