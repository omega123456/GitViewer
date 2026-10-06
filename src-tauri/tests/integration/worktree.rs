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
