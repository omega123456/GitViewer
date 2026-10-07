use super::ipc::{app, dispatch};
use super::workflows::{base, command, fixture};
use gitviewer_lib::{branch, repo::Registry, worktree};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Listener;
use tokio::time::timeout;

fn canonical(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

async fn add(main: &Path, path: &Path, args: &[&str]) {
    let mut full = vec!["worktree", "add"];
    full.extend_from_slice(args);
    full.push(path.to_str().unwrap());
    command(main, &full).await;
}

fn repos(app: &tauri::App<tauri::test::MockRuntime>, name: &str) -> Arc<Mutex<Vec<String>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let captured = seen.clone();
    app.handle().listen(name.to_string(), move |event| {
        let payload: Value = serde_json::from_str(event.payload()).unwrap();
        captured
            .lock()
            .unwrap()
            .push(payload["repo"].as_str().unwrap().to_string());
    });
    seen
}

async fn arrives(seen: &Arc<Mutex<Vec<String>>>, id: &str, touch: impl Fn()) {
    timeout(Duration::from_secs(4), async {
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        while !seen.lock().unwrap().iter().any(|repo| repo == id) {
            interval.tick().await;
            touch();
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn lists_every_worktree_state_and_marks_checked_out_branches() {
    let (dir, repo) = fixture().await;
    base(&dir, &repo).await;
    let others = tempfile::tempdir().unwrap();
    let place = |name: &str| others.path().join(name);
    add(&repo.root, &place("linked"), &["-b", "feat"]).await;
    add(&repo.root, &place("spike"), &["--detach"]).await;
    add(&repo.root, &place("locked"), &["-b", "locked"]).await;
    command(
        &repo.root,
        &[
            "worktree",
            "lock",
            "--reason",
            "on drive",
            place("locked").to_str().unwrap(),
        ],
    )
    .await;
    add(&repo.root, &place("gone"), &["-b", "gone"]).await;
    add(&repo.root, &place("away"), &["-b", "away"]).await;
    command(
        &repo.root,
        &["worktree", "lock", place("away").to_str().unwrap()],
    )
    .await;
    command(&repo.root, &["branch", "idle"]).await;
    let linked = canonical(&place("linked"));
    let locked = canonical(&place("locked"));
    std::fs::remove_dir_all(place("gone")).unwrap();
    std::fs::remove_dir_all(place("away")).unwrap();

    let list = worktree::list(&repo.root).await.unwrap();
    let find = |name: &str| list.iter().find(|entry| entry.name == name).unwrap();
    let main = &list[0];
    assert!(main.main && !main.bare && !main.missing);
    assert_eq!(main.id, repo.root.to_string_lossy());
    assert_eq!(main.branch, "main");
    assert_eq!(main.oid.len(), 40);
    let feat = find("linked");
    assert!(!feat.main && !feat.detached && feat.locked.is_none());
    assert_eq!(
        (feat.id.as_str(), feat.branch.as_str()),
        (linked.as_str(), "feat")
    );
    let spike = find("spike");
    assert!(spike.detached && spike.branch.is_empty());
    let held = find("locked");
    assert_eq!(held.id, locked);
    assert_eq!(held.locked.as_deref(), Some("on drive"));
    assert!(!held.missing && !held.prunable);
    let gone = find("gone");
    assert!(gone.missing && gone.prunable);
    let away = find("away");
    assert!(away.missing && !away.prunable);
    assert_eq!(away.locked.as_deref(), Some(""));

    let branches = branch::list(&repo).await.unwrap();
    let checked = |name: &str| {
        branches
            .iter()
            .find(|branch| branch.name == name)
            .unwrap()
            .worktree
            .clone()
    };
    assert_eq!(checked("main"), repo.root.to_string_lossy());
    assert_eq!(checked("feat"), linked);
    assert_eq!(checked("idle"), "");
    let idle = branches
        .iter()
        .find(|branch| branch.name == "idle")
        .unwrap();
    assert!(serde_json::to_value(idle)
        .unwrap()
        .get("worktree")
        .is_none());
}

#[tokio::test]
async fn opening_a_linked_worktree_reports_its_project_and_prune_drops_missing_folders() {
    let (dir, repo) = fixture().await;
    base(&dir, &repo).await;
    let others = tempfile::tempdir().unwrap();
    let linked = others.path().join("linked");
    let gone = others.path().join("gone");
    add(&repo.root, &linked, &["-b", "feat"]).await;
    add(&repo.root, &gone, &["-b", "gone"]).await;
    std::fs::remove_dir_all(&gone).unwrap();
    let app = app();
    let info = dispatch(
        app.handle().clone(),
        "repo_open",
        json!({"path": linked.to_str().unwrap()}),
    )
    .await
    .unwrap();
    assert_eq!(info["id"], canonical(&linked));
    assert_eq!(info["name"], "linked");
    assert_eq!(info["project"], repo.root.to_string_lossy().as_ref());
    let id = info["id"].as_str().unwrap();
    let listed = dispatch(app.handle().clone(), "worktrees", json!({"repo": id}))
        .await
        .unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 3);
    assert!(listed
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["id"] == id && entry["branch"] == "feat"));
    dispatch(app.handle().clone(), "worktree_prune", json!({"repo": id}))
        .await
        .unwrap();
    let pruned = dispatch(app.handle().clone(), "worktrees", json!({"repo": id}))
        .await
        .unwrap();
    assert_eq!(pruned.as_array().unwrap().len(), 2);
    assert!(pruned
        .as_array()
        .unwrap()
        .iter()
        .all(|entry| entry["missing"] == false));
}

#[tokio::test]
async fn a_bare_project_lists_itself_first_and_owns_its_worktrees() {
    let (dir, repo) = fixture().await;
    base(&dir, &repo).await;
    let others = tempfile::tempdir().unwrap();
    let bare = others.path().join("bare.git");
    command(
        &repo.root,
        &["clone", "--bare", ".", bare.to_str().unwrap()],
    )
    .await;
    let linked = others.path().join("work");
    add(&bare, &linked, &["-b", "work"]).await;
    let list = worktree::list(&bare).await.unwrap();
    assert!(list[0].main && list[0].bare && list[0].oid.is_empty());
    assert_eq!(list[0].name, "bare.git");
    assert_eq!(list[1].branch, "work");
    let registry = Registry::default();
    let info = registry.open(linked.to_str().unwrap()).await.unwrap();
    assert_eq!(info.project, canonical(&bare));
    assert!(registry.open(bare.to_str().unwrap()).await.is_err());
}

#[tokio::test]
async fn linked_worktree_watchers_follow_their_own_index_and_shared_refs() {
    let (dir, repo) = fixture().await;
    base(&dir, &repo).await;
    let others = tempfile::tempdir().unwrap();
    let linked: PathBuf = others.path().join("linked");
    add(&repo.root, &linked, &["-b", "feat"]).await;
    let app = app();
    let statuses = repos(&app, "repo://status-changed");
    let heads = repos(&app, "repo://head-changed");
    let main = repo.root.to_string_lossy().into_owned();
    dispatch(app.handle().clone(), "repo_open", json!({"path": &main}))
        .await
        .unwrap();
    let opened = dispatch(
        app.handle().clone(),
        "repo_open",
        json!({"path": linked.to_str().unwrap()}),
    )
    .await
    .unwrap();
    let id = opened["id"].as_str().unwrap().to_string();
    std::fs::write(linked.join("staged.txt"), "staged").unwrap();
    tokio::time::sleep(Duration::from_millis(1500)).await;
    statuses.lock().unwrap().clear();
    heads.lock().unwrap().clear();

    command(&linked, &["add", "staged.txt"]).await;
    arrives(&statuses, &id, || {}).await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(!statuses.lock().unwrap().contains(&main));

    command(&linked, &["commit", "-m", "Linked"]).await;
    arrives(&heads, &id, || {}).await;
}

async fn project() -> (tempfile::TempDir, PathBuf) {
    let holder = tempfile::tempdir().unwrap();
    let main = holder.path().join("app");
    std::fs::create_dir(&main).unwrap();
    command(&main, &["init", "--initial-branch=main"]).await;
    command(&main, &["config", "user.name", "Fixture Author"]).await;
    command(&main, &["config", "user.email", "fixture@example.invalid"]).await;
    command(&main, &["config", "core.autocrlf", "false"]).await;
    std::fs::write(main.join("file.txt"), "one\ntwo\nthree\n").unwrap();
    command(&main, &["add", "file.txt"]).await;
    command(&main, &["commit", "-m", "Initial"]).await;
    (holder, PathBuf::from(canonical(&main)))
}

async fn open(app: &tauri::App<tauri::test::MockRuntime>, path: &Path) -> String {
    dispatch(
        app.handle().clone(),
        "repo_open",
        json!({"path": path.to_str().unwrap()}),
    )
    .await
    .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn call(app: &tauri::App<tauri::test::MockRuntime>, name: &str, args: Value) -> Value {
    dispatch(app.handle().clone(), name, args).await.unwrap()
}

fn sibling(main: &Path, name: &str) -> String {
    main.parent()
        .unwrap()
        .join(name)
        .to_string_lossy()
        .into_owned()
}

#[tokio::test]
async fn creates_detached_new_and_existing_branch_worktrees_beside_the_project() {
    let (_holder, main) = project().await;
    let app = app();
    let statuses = repos(&app, "repo://status-changed");
    let id = open(&app, &main).await;
    let short = command(&main, &["rev-parse", "--short", "HEAD"]).await;
    let first = format!("app-{}", short.trim());
    let detached = call(
        &app,
        "worktree_target",
        json!({"repo": id, "mode": "detached", "ref": "main", "path": ""}),
    )
    .await;
    assert_eq!(detached["path"], sibling(&main, &first));
    assert_eq!(detached["free"], true);
    assert_eq!(detached["label"], short.trim());
    std::fs::create_dir(sibling(&main, &first)).unwrap();
    std::fs::write(Path::new(&sibling(&main, &first)).join("taken"), "").unwrap();
    let suffixed = call(
        &app,
        "worktree_target",
        json!({"repo": id, "mode": "detached", "ref": "main", "path": ""}),
    )
    .await;
    assert_eq!(suffixed["path"], sibling(&main, &format!("{first}-2")));
    let taken = call(
        &app,
        "worktree_target",
        json!({"repo": id, "mode": "detached", "ref": "main", "path": sibling(&main, &first)}),
    )
    .await;
    assert_eq!(taken["free"], false);
    let unnamed = call(
        &app,
        "worktree_target",
        json!({"repo": id, "mode": "new", "ref": "", "path": ""}),
    )
    .await;
    assert_eq!(unnamed["path"], sibling(&main, "app-worktree"));

    let spike = suffixed["path"].as_str().unwrap();
    let created = call(
        &app,
        "worktree_add",
        json!({"repo": id, "path": spike, "mode": "detached", "base": "main"}),
    )
    .await;
    assert_eq!(created, spike);
    let list = worktree::list(&main).await.unwrap();
    assert!(list.iter().any(|entry| entry.id == spike && entry.detached));

    let linked = open(&app, Path::new(spike)).await;
    statuses.lock().unwrap().clear();
    let feature = call(
        &app,
        "worktree_target",
        json!({"repo": linked, "mode": "new", "ref": "feature/x", "path": ""}),
    )
    .await;
    assert_eq!(feature["path"], sibling(&main, "app-feature-x"));
    call(
        &app,
        "worktree_add",
        json!({"repo": linked, "path": feature["path"], "mode": "new", "branch": "feature/x", "base": "main"}),
    )
    .await;
    assert!(statuses
        .lock()
        .unwrap()
        .contains(&main.to_string_lossy().into_owned()));
    assert!(worktree::list(&main)
        .await
        .unwrap()
        .iter()
        .any(|entry| entry.branch == "feature/x"));

    command(&main, &["remote", "add", "origin", main.to_str().unwrap()]).await;
    command(&main, &["update-ref", "refs/remotes/origin/topic", "HEAD"]).await;
    let topic = call(
        &app,
        "worktree_target",
        json!({"repo": id, "mode": "existing", "ref": "origin/topic", "path": ""}),
    )
    .await;
    assert_eq!(topic["path"], sibling(&main, "app-topic"));
    call(
        &app,
        "worktree_add",
        json!({"repo": id, "path": topic["path"], "mode": "existing", "branch": "origin/topic"}),
    )
    .await;
    assert_eq!(
        command(&main, &["rev-parse", "--abbrev-ref", "topic@{upstream}"])
            .await
            .trim(),
        "origin/topic"
    );
    command(&main, &["branch", "idle"]).await;
    call(
        &app,
        "worktree_add",
        json!({"repo": id, "path": sibling(&main, "app-idle"), "mode": "existing", "branch": "idle"}),
    )
    .await;
    assert!(worktree::list(&main)
        .await
        .unwrap()
        .iter()
        .any(|entry| entry.branch == "idle"));

    for refused in [
        json!({"repo": id, "path": "relative", "mode": "detached", "base": "main"}),
        json!({"repo": id, "path": sibling(&main, "app-bad"), "mode": "detached", "base": "-x"}),
    ] {
        assert!(dispatch(app.handle().clone(), "worktree_add", refused)
            .await
            .is_err());
    }
}

#[tokio::test]
async fn summaries_count_orphan_commits_and_removal_needs_force_for_dirty_and_locked() {
    let (_holder, main) = project().await;
    let app = app();
    let id = open(&app, &main).await;
    let spike = PathBuf::from(sibling(&main, "app-spike"));
    let feat = PathBuf::from(sibling(&main, "app-feat"));
    add(&main, &spike, &["--detach"]).await;
    add(&main, &feat, &["-b", "feat"]).await;
    for place in [&spike, &feat] {
        std::fs::write(place.join("more.txt"), place.to_str().unwrap()).unwrap();
        command(place, &["add", "more.txt"]).await;
        command(place, &["commit", "-m", "More"]).await;
    }
    std::fs::write(feat.join(".gitmodules"), "").unwrap();
    let spike_id = open(&app, &spike).await;
    let feat_id = open(&app, &feat).await;
    let summary = call(
        &app,
        "worktree_summary",
        json!({"repo": spike_id, "target": id}),
    )
    .await;
    assert_eq!(
        summary,
        json!({"ahead": 1, "orphans": 1, "submodules": false})
    );
    let summary = call(
        &app,
        "worktree_summary",
        json!({"repo": feat_id, "target": id}),
    )
    .await;
    assert_eq!(
        summary,
        json!({"ahead": 1, "orphans": 0, "submodules": true})
    );

    assert!(dispatch(
        app.handle().clone(),
        "worktree_remove",
        json!({"repo": id, "worktree": feat_id}),
    )
    .await
    .is_err());
    call(
        &app,
        "worktree_remove",
        json!({"repo": id, "worktree": feat_id, "force": 1}),
    )
    .await;
    assert!(!feat.exists());
    command(&main, &["worktree", "lock", spike.to_str().unwrap()]).await;
    assert!(dispatch(
        app.handle().clone(),
        "worktree_remove",
        json!({"repo": id, "worktree": spike_id, "force": 1}),
    )
    .await
    .is_err());
    call(
        &app,
        "worktree_remove",
        json!({"repo": id, "worktree": spike_id, "force": 2}),
    )
    .await;
    assert!(!spike.exists());
    assert_eq!(worktree::list(&main).await.unwrap().len(), 1);
}

#[tokio::test]
async fn apply_copies_commits_and_uncommitted_work_into_main_and_undo_reverses_it() {
    let (_holder, main) = project().await;
    let app = app();
    let statuses = repos(&app, "repo://status-changed");
    let id = open(&app, &main).await;
    let linked = PathBuf::from(sibling(&main, "app-feat"));
    add(&main, &linked, &["-b", "feat"]).await;
    std::fs::write(linked.join("file.txt"), "ONE\ntwo\nthree\n").unwrap();
    command(&linked, &["commit", "-am", "Shout"]).await;
    std::fs::write(linked.join("staged.txt"), "staged\n").unwrap();
    command(&linked, &["add", "staged.txt"]).await;
    std::fs::write(linked.join("new.txt"), "new\n").unwrap();
    let source = open(&app, &linked).await;
    let index = command(&linked, &["ls-files", "-s"]).await;
    let status = command(&linked, &["status", "--porcelain"]).await;
    let head = command(&main, &["rev-parse", "HEAD"]).await;
    statuses.lock().unwrap().clear();

    let applied = call(
        &app,
        "worktree_apply",
        json!({"repo": source, "source": source, "target": id}),
    )
    .await;
    assert_eq!(applied["files"], 3);
    assert_eq!(applied["conflicts"], 0);
    assert!(statuses.lock().unwrap().contains(&id));
    assert_eq!(command(&main, &["rev-parse", "HEAD"]).await, head);
    assert_eq!(
        std::fs::read_to_string(main.join("file.txt")).unwrap(),
        "ONE\ntwo\nthree\n"
    );
    assert_eq!(
        std::fs::read_to_string(main.join("new.txt")).unwrap(),
        "new\n"
    );
    assert!(command(&main, &["diff", "--cached", "--name-only"])
        .await
        .is_empty());
    assert_eq!(command(&linked, &["ls-files", "-s"]).await, index);
    assert_eq!(command(&linked, &["status", "--porcelain"]).await, status);

    call(
        &app,
        "worktree_unapply",
        json!({"repo": source, "target": id, "base": applied["base"], "tree": applied["tree"]}),
    )
    .await;
    assert!(command(&main, &["status", "--porcelain"]).await.is_empty());

    let again = call(
        &app,
        "worktree_apply",
        json!({"repo": id, "source": source, "target": id}),
    )
    .await;
    std::fs::write(main.join("new.txt"), "edited\n").unwrap();
    let refused = dispatch(
        app.handle().clone(),
        "worktree_unapply",
        json!({"repo": id, "target": id, "base": again["base"], "tree": again["tree"]}),
    )
    .await
    .unwrap_err();
    assert!(refused.message.contains("Main changed"));
    assert!(dispatch(
        app.handle().clone(),
        "worktree_unapply",
        json!({"repo": id, "target": id, "base": "--output=x", "tree": again["tree"]}),
    )
    .await
    .is_err());
    assert!(dispatch(
        app.handle().clone(),
        "worktree_apply",
        json!({"repo": id, "source": id, "target": id}),
    )
    .await
    .is_err());

    let idle = PathBuf::from(sibling(&main, "app-idle"));
    add(&main, &idle, &["--detach"]).await;
    let idle_id = open(&app, &idle).await;
    let nothing = call(
        &app,
        "worktree_apply",
        json!({"repo": id, "source": idle_id, "target": id}),
    )
    .await;
    assert_eq!(nothing["files"], 0);
}

#[tokio::test]
async fn overlapping_main_changes_are_stashed_around_the_apply_or_left_untouched() {
    let (_holder, main) = project().await;
    let app = app();
    let id = open(&app, &main).await;
    let linked = PathBuf::from(sibling(&main, "app-feat"));
    add(&main, &linked, &["-b", "feat"]).await;
    std::fs::write(linked.join("file.txt"), "ONE\ntwo\nthree\n").unwrap();
    let source = open(&app, &linked).await;
    std::fs::write(main.join("file.txt"), "one\ntwo\nTHREE\n").unwrap();
    let args = json!({"repo": source, "source": source, "target": id});
    let overlap = dispatch(app.handle().clone(), "worktree_apply", args.clone())
        .await
        .unwrap_err();
    assert_eq!(overlap.category, "overlap");
    assert_eq!(overlap.message, "Main has changes to:\nfile.txt");
    let mut smart = args.clone();
    smart["smart"] = json!(true);
    call(&app, "worktree_apply", smart.clone()).await;
    assert_eq!(
        std::fs::read_to_string(main.join("file.txt")).unwrap(),
        "ONE\ntwo\nTHREE\n"
    );
    assert!(command(&main, &["stash", "list"]).await.is_empty());

    command(&main, &["checkout", "--", "file.txt"]).await;
    std::fs::write(main.join("file.txt"), "uno\ntwo\nthree\n").unwrap();
    std::fs::write(main.join("notes.txt"), "mine\n").unwrap();
    let refused = dispatch(app.handle().clone(), "worktree_apply", smart)
        .await
        .unwrap_err();
    assert!(refused.message.starts_with("Main was left as it was."));
    assert_eq!(
        std::fs::read_to_string(main.join("file.txt")).unwrap(),
        "uno\ntwo\nthree\n"
    );
    assert_eq!(
        std::fs::read_to_string(main.join("notes.txt")).unwrap(),
        "mine\n"
    );
    assert!(command(&main, &["stash", "list"]).await.is_empty());
}

#[tokio::test]
async fn a_three_way_apply_merges_cleanly_or_leaves_conflicts_when_main_moved_on() {
    let (_holder, main) = project().await;
    let app = app();
    let id = open(&app, &main).await;
    let linked = PathBuf::from(sibling(&main, "app-feat"));
    add(&main, &linked, &["-b", "feat"]).await;
    std::fs::write(linked.join("file.txt"), "ONE\ntwo\nthree\n").unwrap();
    let source = open(&app, &linked).await;
    std::fs::write(main.join("file.txt"), "one\ntwo\nthree\nfour\n").unwrap();
    command(&main, &["commit", "-am", "Four"]).await;
    let args = json!({"repo": id, "source": source, "target": id});
    let merged = call(&app, "worktree_apply", args.clone()).await;
    assert_eq!(merged["conflicts"], 0);
    assert_eq!(
        std::fs::read_to_string(main.join("file.txt")).unwrap(),
        "ONE\ntwo\nthree\nfour\n"
    );
    assert!(command(&main, &["diff", "--cached", "--name-only"])
        .await
        .is_empty());

    command(&main, &["checkout", "--", "file.txt"]).await;
    std::fs::write(main.join("file.txt"), "uno\ntwo\nthree\nfour\n").unwrap();
    command(&main, &["commit", "-am", "Uno"]).await;
    let conflicted = call(&app, "worktree_apply", args).await;
    assert_eq!(conflicted["conflicts"], 1);
    assert!(std::fs::read_to_string(main.join("file.txt"))
        .unwrap()
        .contains("<<<<<<<"));
}
