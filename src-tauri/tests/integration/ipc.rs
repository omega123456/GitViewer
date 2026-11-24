use super::support::{
    Polling, base, command, counted, fixture, poll_until, stop_tracing_git_events, trace_file,
    trace_git_events,
};
use gitviewer_lib::{blob, error::Error, ipc, media, repo::Registry};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Listener, Manager};
use tempfile::TempDir;
use tokio::time::timeout;

pub(super) fn dispatch<AppRuntime: tauri::Runtime>(
    app: tauri::AppHandle<AppRuntime>,
    command: &str,
    args: Value,
) -> impl std::future::Future<Output = Result<Value, Error>> + use<AppRuntime> {
    let command = command.to_string();
    async move {
        ipc::dispatch(app, command, args)
            .await
            .map(|raw| serde_json::from_str(raw.get()).unwrap())
    }
}

pub(super) fn app() -> tauri::App<tauri::test::MockRuntime> {
    gitviewer_lib::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}

struct OpenedApp {
    dir: TempDir,
    app: tauri::App<tauri::test::MockRuntime>,
    id: String,
}

async fn open_seeded_app() -> OpenedApp {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let app = app();
    let info = dispatch(
        app.handle().clone(),
        "repo_open",
        json!({"path":dir.path()}),
    )
    .await
    .unwrap();
    let id = info["id"].as_str().unwrap().to_string();
    OpenedApp { dir, app, id }
}

async fn call(app: &tauri::App<tauri::test::MockRuntime>, name: &str, args: Value) -> Value {
    dispatch(app.handle().clone(), name, args).await.unwrap()
}

#[tokio::test]
async fn environment_settings_and_ai_commands_validate_inputs_and_store_keys() {
    let app = app();
    let run = |name: &str, args: Value| dispatch(app.handle().clone(), name, args);
    assert!(
        run("env", json!({})).await.unwrap()["supported"]
            .as_bool()
            .unwrap()
    );
    assert!(run("settings_get", json!({})).await.is_err());
    assert!(run("settings_set", json!({})).await.is_err());
    assert!(run("ai_models", json!({})).await.is_err());
    assert!(run("ai_generate", json!({"repo":"missing"})).await.is_err());
    assert!(run("ai_key_set", json!({})).await.is_err());
    run("ai_key_set", json!({"key":"stored-secret"}))
        .await
        .unwrap();
    assert!(gitviewer_lib::ai::key_stored());
    run("ai_key_set", json!({"key":""})).await.unwrap();
    assert!(!gitviewer_lib::ai::key_stored());
    assert!(run("repo_open", json!({})).await.is_err());
}

async fn assert_commit_and_file_read_commands(opened: &OpenedApp) {
    let id = &opened.id;
    assert!(
        call(
            &opened.app,
            "file_lines",
            json!({"repo":id,"path":"file.txt","source":"commit","revision":"HEAD"})
        )
        .await
        .is_string()
    );
    assert!(
        call(
            &opened.app,
            "file_lines",
            json!({"repo":id,"path":"file.txt","source":"commit","revision":"HEAD","old":true})
        )
        .await
        .is_string()
    );
    call(&opened.app, "blame", json!({"repo":id,"path":"file.txt"})).await;
    assert_eq!(
        call(
            &opened.app,
            "commit_detail",
            json!({"repo":id,"revision":"HEAD"})
        )
        .await["body"],
        json!("")
    );
    assert_eq!(
        call(
            &opened.app,
            "commit_files",
            json!({"repo":id,"revision":"HEAD"})
        )
        .await,
        json!({"statuses":{"file.txt":"A"},"lines":{"file.txt":[3,0]}})
    );
    assert_eq!(
        call(&opened.app, "line_stats", json!({"repo":id})).await,
        json!({"staged":{},"unstaged":{}})
    );
}

#[tokio::test]
async fn repository_read_commands_and_diff_stack_are_wired() {
    let opened = open_seeded_app().await;
    let id = &opened.id;
    assert!(
        ipc::execute(
            opened.app.handle().clone(),
            "status".into(),
            json!({"repo": id})
        )
        .await
        .is_ok()
    );
    assert_eq!(
        call(&opened.app, "repo_open", json!({"path":opened.dir.path()})).await["id"],
        *id
    );
    for name in [
        "status",
        "refresh",
        "tree",
        "files",
        "branches",
        "default_branch",
        "history",
        "stashes",
    ] {
        call(&opened.app, name, json!({"repo":id})).await;
    }
    call(
        &opened.app,
        "compare_files",
        json!({"repo":id,"base":"HEAD","target":"HEAD","mergeBase":true}),
    )
    .await;
    call(
        &opened.app,
        "diff",
        json!({"repo":id,"path":"file.txt","source":"file"}),
    )
    .await;
    assert_commit_and_file_read_commands(&opened).await;
}

#[tokio::test]
async fn diff_stack_command_matches_single_diff_and_refuses_file_source() {
    let opened = open_seeded_app().await;
    let id = &opened.id;
    let stack = call(
        &opened.app,
        "diff_stack",
        json!({"repo":id,"source":"commit","revision":"HEAD"}),
    )
    .await;
    assert_eq!(stack["truncated"], json!(false));
    assert_eq!(stack["files"]["file.txt"]["path"], json!("file.txt"));
    assert_eq!(
        stack["files"]["file.txt"]["patches"],
        call(
            &opened.app,
            "diff",
            json!({"repo":id,"path":"file.txt","source":"commit","revision":"HEAD"})
        )
        .await["patches"]
    );
    assert_eq!(
        dispatch(
            opened.app.handle().clone(),
            "diff_stack",
            json!({"repo":id,"source":"file"})
        )
        .await
        .unwrap_err()
        .category,
        "refused"
    );
}

#[tokio::test]
async fn branch_commands_create_merge_delete_and_prune() {
    let opened = open_seeded_app().await;
    let id = &opened.id;
    let app = &opened.app;
    call(
        app,
        "branch_create",
        json!({"repo":id,"name":"feature","base":"HEAD","checkout":true}),
    )
    .await;
    call(app, "branch_switch", json!({"repo":id,"name":"main"})).await;
    let preview = call(app, "merge_preview", json!({"repo":id,"name":"feature"})).await;
    assert_eq!(preview["outcome"], "upToDate");
    let merged = call(app, "branch_merge", json!({"repo":id,"name":"feature"})).await;
    assert_eq!(merged, json!(true));
    assert!(
        dispatch(app.handle().clone(), "merge_abort", json!({"repo":id}))
            .await
            .is_err()
    );
    call(app, "branch_delete", json!({"repo":id,"name":"feature"})).await;
    assert_eq!(
        call(app, "branch_gone", json!({"repo":id})).await,
        json!([])
    );
    assert_eq!(
        call(app, "branch_prune", json!({"repo":id,"names":[]})).await,
        json!({"deleted":[],"kept":[]})
    );
    assert!(
        dispatch(app.handle().clone(), "branch_prune", json!({"repo":id}))
            .await
            .is_err()
    );
}

async fn assert_stash_ipc_round_trip(app: &tauri::App<tauri::test::MockRuntime>, id: &str) {
    let hash = call(app, "stash_save", json!({"repo":id,"message":"IPC stash"})).await;
    call(
        app,
        "stash_apply",
        json!({"repo":id,"hash":hash,"pop":false,"smart":false}),
    )
    .await;
    call(
        app,
        "commit_files",
        json!({"repo":id,"revision":hash,"source":"stash"}),
    )
    .await;
    call(app, "smart_checkout", json!({"repo":id,"name":"main"})).await;
    call(app, "stash_drop", json!({"repo":id,"hash":hash})).await;
    call(
        app,
        "stash_restore",
        json!({"repo":id,"hash":hash,"message":"On main: IPC stash"}),
    )
    .await;
    call(app, "stash_drop", json!({"repo":id,"hash":hash})).await;
}

#[tokio::test]
async fn hunk_stash_commit_and_sync_commands_emit_progress() {
    let opened = open_seeded_app().await;
    let id = &opened.id;
    std::fs::write(opened.dir.path().join("file.txt"), "changed\n").unwrap();
    call(&opened.app, "refresh", json!({"repo":id})).await;
    let unstaged = call(
        &opened.app,
        "diff",
        json!({"repo":id,"path":"file.txt","source":"unstaged"}),
    )
    .await;
    call(
        &opened.app,
        "hunk_action",
        json!({"repo":id,"path":"file.txt","source":"unstaged","hunk":0,"patch":unstaged["patches"][0],"action":"stage"}),
    )
    .await;
    call(
        &opened.app,
        "files_action",
        json!({"repo":id,"paths":["file.txt"],"action":"unstage"}),
    )
    .await;
    assert_stash_ipc_round_trip(&opened.app, id).await;
    call(
        &opened.app,
        "files_action",
        json!({"repo":id,"paths":["file.txt"],"action":"stage"}),
    )
    .await;
    let oid = call(
        &opened.app,
        "commit",
        json!({"repo":id,"message":"IPC commit"}),
    )
    .await;
    assert_eq!(oid.as_str().map(str::len), Some(40));
    assert_sync_progress_and_unknown_commands(&opened).await;
}

async fn assert_sync_progress_and_unknown_commands(opened: &OpenedApp) {
    let id = &opened.id;
    let progress = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captured = progress.clone();
    opened.app.handle().listen("sync://progress", move |event| {
        captured
            .lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    call(&opened.app, "sync", json!({"repo":id,"action":"fetch"})).await;
    let completion = progress.lock().unwrap().last().cloned().unwrap();
    assert_eq!(completion["done"], json!(true));
    assert_eq!(completion["message"], json!("fetch complete"));
    assert!(
        dispatch(
            opened.app.handle().clone(),
            "sync",
            json!({"repo":id,"action":"invalid"})
        )
        .await
        .is_err()
    );
    let failure = progress.lock().unwrap().last().cloned().unwrap();
    assert_eq!(failure["done"], json!(true));
    assert!(
        failure["message"]
            .as_str()
            .unwrap()
            .starts_with("invalid failed:")
    );
    assert!(
        dispatch(
            opened.app.handle().clone(),
            "system_open",
            json!({"repo":id,"path":"file.txt"})
        )
        .await
        .is_err()
    );
    assert!(
        dispatch(opened.app.handle().clone(), "unknown", json!({"repo":id}))
            .await
            .is_err()
    );
    assert!(
        dispatch(
            opened.app.handle().clone(),
            "status",
            json!({"repo":"missing"})
        )
        .await
        .is_err()
    );
}

fn blob_url(scheme: &str, id: &str, path: &str) -> String {
    let mut url = tauri::Url::parse(scheme).unwrap();
    url.query_pairs_mut()
        .append_pair("repo", id)
        .append_pair("path", path)
        .append_pair("source", "file")
        .append_pair("side", "new");
    url.to_string()
}

#[tokio::test]
async fn gitblob_protocol_serves_media_and_enforces_size_limits() {
    let opened = open_seeded_app().await;
    let id = &opened.id;
    let root = opened.dir.path();
    std::fs::write(root.join("picture.png"), b"image bytes").unwrap();
    assert_eq!(
        blob::serve(
            opened.app.handle(),
            blob_url("gitblob://localhost/image", id, "picture.png")
        )
        .await
        .unwrap()
        .bytes,
        b"image bytes"
    );
    for extension in ["svg", "jpg", "gif", "webp", "bmp", "ico", "avif"] {
        let path = format!("image.{extension}");
        std::fs::write(root.join(&path), b"image").unwrap();
        assert!(
            blob::serve(
                opened.app.handle(),
                blob_url("gitblob://localhost/image", id, &path)
            )
            .await
            .unwrap()
            .mime
            .starts_with("image/")
        );
    }
    assert!(
        blob::serve(opened.app.handle(), "not a url".into())
            .await
            .is_err()
    );
    let plain = blob::serve(
        opened.app.handle(),
        blob_url("gitblob://localhost/image", id, "file.txt"),
    )
    .await
    .unwrap();
    assert_eq!(plain.mime, "text/plain; charset=utf-8");
    assert_eq!(plain.bytes, std::fs::read(root.join("file.txt")).unwrap());
    assert_eq!(media::mime("archive.tar.gz"), "text/plain; charset=utf-8");
    assert_blob_size_limits_and_close(&opened).await;
}

async fn assert_blob_size_limits_and_close(opened: &OpenedApp) {
    let id = &opened.id;
    let root = opened.dir.path();
    let over_limit = 20 * 1024 * 1024 + 1;
    std::fs::File::create(root.join("large.png"))
        .unwrap()
        .set_len(over_limit)
        .unwrap();
    assert_eq!(
        blob::serve(
            opened.app.handle(),
            blob_url("http://gitblob.localhost/image", id, "large.png")
        )
        .await
        .unwrap_err()
        .message,
        "Image exceeds the 20 MB limit"
    );
    std::fs::File::create(root.join("large.txt"))
        .unwrap()
        .set_len(over_limit)
        .unwrap();
    assert_eq!(
        blob::serve(
            opened.app.handle(),
            blob_url("gitblob://localhost/image", id, "large.txt")
        )
        .await
        .unwrap_err()
        .message,
        "File exceeds the 20 MB limit"
    );
    call(&opened.app, "repo_close", json!({"repo":id})).await;
    assert!(opened.app.state::<Registry>().get(id).await.is_err());
}

#[tokio::test]
async fn reads_proceed_while_a_write_holds_the_repository() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    std::fs::write(dir.path().join(".gitignore"), "generated/\n").unwrap();
    std::fs::create_dir(dir.path().join("generated")).unwrap();
    std::fs::write(dir.path().join("file.txt"), "changed\n").unwrap();
    let app = app();
    let run = |name: &str, args: Value| dispatch(app.handle().clone(), name, args);
    let info = run("repo_open", json!({"path":dir.path()})).await.unwrap();
    let id = info["id"].as_str().unwrap();
    let repo = app.state::<Registry>().get(id).await.unwrap();
    let files = Arc::new(Mutex::new(0));
    let counted_events = files.clone();
    app.handle().listen("repo://files-changed", move |_| {
        *counted_events.lock().unwrap() += 1;
    });
    let write = repo.writes.lock().await;
    let patient = Duration::from_secs(5);
    for (name, args) in [
        ("status", json!({"repo":id})),
        ("tree", json!({"repo":id,"path":""})),
        (
            "diff",
            json!({"repo":id,"path":"file.txt","source":"unstaged"}),
        ),
        ("stashes", json!({"repo":id})),
    ] {
        timeout(patient, run(name, args)).await.unwrap().unwrap();
    }
    assert!(
        timeout(
            Duration::from_millis(200),
            run("refresh", json!({"repo":id}))
        )
        .await
        .is_err()
    );
    drop(write);
    poll_until(
        Polling {
            limit: patient,
            period: Duration::from_millis(500),
        },
        || *files.lock().unwrap() != 0,
        || std::fs::write(dir.path().join("generated").join("out.js"), "out").unwrap(),
    )
    .await;
}

fn counter(app: &tauri::App<tauri::test::MockRuntime>, name: &str) -> Arc<Mutex<usize>> {
    let count = Arc::new(Mutex::new(0));
    let captured = count.clone();
    app.handle().listen(name.to_string(), move |_| {
        *captured.lock().unwrap() += 1;
    });
    count
}
fn read(count: &Arc<Mutex<usize>>) -> usize {
    *count.lock().unwrap()
}

struct PatchFixture {
    opened: OpenedApp,
    stash: String,
}

async fn setup_patch_fixture() -> PatchFixture {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let root = dir.path();
    std::fs::write(root.join("file.txt"), "one\nTWO\nthree\n").unwrap();
    std::fs::write(root.join("staged.txt"), "staged\n").unwrap();
    command(root, &["add", "staged.txt"]).await;
    command(root, &["commit", "-am", "Second"]).await;
    std::fs::write(root.join("staged.txt"), "staged\nmore\n").unwrap();
    command(root, &["add", "staged.txt"]).await;
    std::fs::write(root.join("file.txt"), "one\nTWO\nthree\nfour\n").unwrap();
    let app = app();
    let info = call(&app, "repo_open", json!({"path":root})).await;
    let id = info["id"].as_str().unwrap().to_string();
    let stash = command(root, &["stash", "create"]).await.trim().to_string();
    PatchFixture {
        opened: OpenedApp { dir, app, id },
        stash,
    }
}

#[tokio::test]
async fn non_working_diff_sources_omit_patches() {
    let fixture = setup_patch_fixture().await;
    let app = &fixture.opened.app;
    let id = &fixture.opened.id;
    let committed = [
        ("commit", "file.txt", "HEAD", ""),
        ("stash", "file.txt", fixture.stash.as_str(), ""),
        ("compare", "file.txt", "HEAD", "HEAD~1"),
        ("file", "file.txt", "", ""),
    ];
    for (source, path, revision, base_ref) in committed {
        let single = call(
            app,
            "diff",
            json!({"repo":id,"path":path,"source":source,"revision":revision,"base":base_ref}),
        )
        .await;
        assert_eq!(single["patches"], json!([]), "{source}");
    }
    for (source, path, revision, base_ref) in committed
        .into_iter()
        .filter(|(source, ..)| *source != "file")
    {
        let single = call(
            app,
            "diff",
            json!({"repo":id,"path":path,"source":source,"revision":revision,"base":base_ref}),
        )
        .await;
        assert!(!single["hunks"].as_array().unwrap().is_empty(), "{source}");
        let stack = call(
            app,
            "diff_stack",
            json!({"repo":id,"source":source,"revision":revision,"base":base_ref}),
        )
        .await;
        assert_eq!(stack["files"][path]["patches"], json!([]), "{source}");
    }
}

async fn assert_minimal_ordinary_status(app: &tauri::App<tauri::test::MockRuntime>, id: &str) {
    let status = call(app, "status", json!({"repo":id})).await;
    let ordinary = status["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["kind"] == "ordinary");
    for entry in ordinary {
        let mut keys: Vec<&str> = entry
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["index", "kind", "path", "worktree"]);
    }
}

#[tokio::test]
async fn working_tree_diff_sources_carry_applicable_patches_and_minimal_status() {
    let fixture = setup_patch_fixture().await;
    let app = &fixture.opened.app;
    let id = &fixture.opened.id;
    let root = fixture.opened.dir.path();
    for (source, path) in [("unstaged", "file.txt"), ("staged", "staged.txt")] {
        let single = call(app, "diff", json!({"repo":id,"path":path,"source":source})).await;
        let stack = call(app, "diff_stack", json!({"repo":id,"source":source})).await;
        let hunks = single["hunks"].as_array().unwrap().len();
        assert_eq!(hunks, 1);
        assert_eq!(single["patches"].as_array().unwrap().len(), hunks);
        assert!(
            single["patches"][0]
                .as_str()
                .unwrap()
                .starts_with("diff --git")
        );
        assert_eq!(stack["files"][path]["patches"], single["patches"]);
    }
    let staged = call(
        app,
        "diff",
        json!({"repo":id,"path":"staged.txt","source":"staged"}),
    )
    .await;
    call(
        app,
        "hunk_action",
        json!({"repo":id,"path":"staged.txt","source":"staged","hunk":0,"patch":staged["patches"][0],"action":"unstage"}),
    )
    .await;
    let unstaged = call(
        app,
        "diff",
        json!({"repo":id,"path":"file.txt","source":"unstaged"}),
    )
    .await;
    call(
        app,
        "hunk_action",
        json!({"repo":id,"path":"file.txt","source":"unstaged","hunk":0,"patch":unstaged["patches"][0],"action":"stage"}),
    )
    .await;
    assert_eq!(
        command(root, &["diff", "--cached", "--name-only"])
            .await
            .trim(),
        "file.txt"
    );
    assert_minimal_ordinary_status(app, id).await;
}

#[tokio::test]
async fn refresh_reads_status_once_and_reports_head_moves() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let root = dir.path();
    let app = app();
    let id = app
        .state::<Registry>()
        .open(root.to_str().unwrap())
        .await
        .unwrap()
        .id;
    let status = counter(&app, "repo://status-changed");
    let head = counter(&app, "repo://head-changed");
    let trace = trace_file(&dir, "refresh-trace");
    trace_git_events(&trace);
    let refresh = || async {
        dispatch(app.handle().clone(), "refresh", json!({"repo":id}))
            .await
            .unwrap()
    };
    let processes = counted(&trace, refresh()).await;
    stop_tracing_git_events();
    std::fs::remove_file(&trace).ok();
    assert_eq!(processes, 1);
    assert_eq!((read(&status), read(&head)), (1, 0));
    refresh().await;
    assert_eq!((read(&status), read(&head)), (2, 0));
    command(root, &["commit", "--allow-empty", "-m", "Moved"]).await;
    refresh().await;
    assert_eq!((read(&status), read(&head)), (3, 1));
    command(root, &["checkout", "-q", "-b", "other"]).await;
    refresh().await;
    assert_eq!((read(&status), read(&head)), (4, 2));
    refresh().await;
    assert_eq!((read(&status), read(&head)), (5, 2));
    assert!(
        dispatch(app.handle().clone(), "refresh", json!({"repo":"missing"}))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn stash_commands_always_report_a_head_change() {
    let (dir, handle) = fixture().await;
    base(&handle).await;
    let root = dir.path();
    std::fs::write(root.join("file.txt"), "stashed\n").unwrap();
    let app = app();
    let id = app
        .state::<Registry>()
        .open(root.to_str().unwrap())
        .await
        .unwrap()
        .id;
    let head = counter(&app, "repo://head-changed");
    let run = |name: &str, args: Value| dispatch(app.handle().clone(), name, args);
    let hash = run("stash_save", json!({"repo":id,"message":"Saved"}))
        .await
        .unwrap();
    assert_eq!(read(&head), 1);
    run(
        "stash_apply",
        json!({"repo":id,"hash":hash,"pop":false,"smart":false}),
    )
    .await
    .unwrap();
    assert_eq!(read(&head), 2);
    run("stash_drop", json!({"repo":id,"hash":hash}))
        .await
        .unwrap();
    assert_eq!(read(&head), 3);
    run(
        "stash_restore",
        json!({"repo":id,"hash":hash,"message":"On main: Saved"}),
    )
    .await
    .unwrap();
    assert_eq!(read(&head), 4);
}
