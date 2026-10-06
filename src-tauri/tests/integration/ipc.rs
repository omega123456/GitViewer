use super::workflows::{base, fixture};
use gitviewer_lib::{blob, error::Error, ipc, repo::Registry};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Listener, Manager};
use tokio::time::timeout;

pub(super) fn dispatch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    command: &str,
    args: Value,
) -> impl std::future::Future<Output = Result<Value, Error>> {
    let command = command.to_string();
    async move {
        ipc::dispatch(app, command, args)
            .await
            .map(|raw| serde_json::from_str(raw.get()).unwrap())
    }
}

#[tokio::test]
async fn typed_commands_events_and_protocol_are_wired() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let app = gitviewer_lib::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let call = |command: &str, args: Value| dispatch(app.handle().clone(), command, args);
    assert!(call("env", json!({})).await.unwrap()["supported"]
        .as_bool()
        .unwrap());
    assert!(call("settings_get", json!({})).await.is_err());
    assert!(call("settings_set", json!({})).await.is_err());
    assert!(call("ai_models", json!({})).await.is_err());
    assert!(call("ai_generate", json!({"repo":"missing"}))
        .await
        .is_err());
    assert!(call("ai_key_set", json!({})).await.is_err());
    call("ai_key_set", json!({"key":"stored-secret"}))
        .await
        .unwrap();
    assert!(gitviewer_lib::ai::key_stored());
    call("ai_key_set", json!({"key":""})).await.unwrap();
    assert!(!gitviewer_lib::ai::key_stored());
    assert!(call("repo_open", json!({})).await.is_err());
    let info = call("repo_open", json!({"path":dir.path()})).await.unwrap();
    let id = info["id"].as_str().unwrap();
    assert!(
        ipc::execute(app.handle().clone(), "status".into(), json!({"repo": id}))
            .await
            .is_ok()
    );
    assert_eq!(
        call("repo_open", json!({"path":dir.path()})).await.unwrap()["id"],
        id
    );
    for command in [
        "status",
        "refresh",
        "tree",
        "files",
        "branches",
        "default_branch",
        "history",
        "stashes",
    ] {
        call(command, json!({"repo":id})).await.unwrap();
    }
    call(
        "compare_files",
        json!({"repo":id,"base":"HEAD","target":"HEAD","mergeBase":true}),
    )
    .await
    .unwrap();
    call("diff", json!({"repo":id,"path":"file.txt","source":"file"}))
        .await
        .unwrap();
    assert!(call(
        "file_lines",
        json!({"repo":id,"path":"file.txt","source":"commit","revision":"HEAD"})
    )
    .await
    .unwrap()
    .is_string());
    let stack = call(
        "diff_stack",
        json!({"repo":id,"source":"commit","revision":"HEAD"}),
    )
    .await
    .unwrap();
    assert_eq!(stack["truncated"], json!(false));
    assert_eq!(stack["files"]["file.txt"]["path"], json!("file.txt"));
    assert_eq!(
        stack["files"]["file.txt"]["patches"],
        call(
            "diff",
            json!({"repo":id,"path":"file.txt","source":"commit","revision":"HEAD"})
        )
        .await
        .unwrap()["patches"]
    );
    assert_eq!(
        call("diff_stack", json!({"repo":id,"source":"file"}))
            .await
            .unwrap_err()
            .category,
        "refused"
    );
    call("blame", json!({"repo":id,"path":"file.txt"}))
        .await
        .unwrap();
    assert_eq!(
        call("commit_files", json!({"repo":id,"revision":"HEAD"}))
            .await
            .unwrap(),
        json!({"statuses":{"file.txt":"A"},"lines":{"file.txt":[3,0]}})
    );
    assert_eq!(
        call("line_stats", json!({"repo":id})).await.unwrap(),
        json!({"staged":{},"unstaged":{}})
    );
    call(
        "branch_create",
        json!({"repo":id,"name":"feature","base":"HEAD","checkout":true}),
    )
    .await
    .unwrap();
    call("branch_switch", json!({"repo":id,"name":"main"}))
        .await
        .unwrap();
    assert_eq!(
        call("merge_preview", json!({"repo":id,"name":"feature"}))
            .await
            .unwrap()["outcome"],
        "upToDate"
    );
    assert_eq!(
        call("branch_merge", json!({"repo":id,"name":"feature"}))
            .await
            .unwrap(),
        json!(true)
    );
    assert!(call("merge_abort", json!({"repo":id})).await.is_err());
    call("branch_delete", json!({"repo":id,"name":"feature"}))
        .await
        .unwrap();
    std::fs::write(dir.path().join("file.txt"), "changed\n").unwrap();
    call("refresh", json!({"repo":id})).await.unwrap();
    let d = call(
        "diff",
        json!({"repo":id,"path":"file.txt","source":"unstaged"}),
    )
    .await
    .unwrap();
    call("hunk_action",json!({"repo":id,"path":"file.txt","source":"unstaged","hunk":0,"patch":d["patches"][0],"action":"stage"})).await.unwrap();
    call(
        "files_action",
        json!({"repo":id,"paths":["file.txt"],"action":"unstage"}),
    )
    .await
    .unwrap();
    let hash = call("stash_save", json!({"repo":id,"message":"IPC stash"}))
        .await
        .unwrap();
    call(
        "stash_apply",
        json!({"repo":id,"hash":hash,"pop":false,"smart":false}),
    )
    .await
    .unwrap();
    assert!(call(
        "commit_files",
        json!({"repo":id,"revision":hash,"source":"stash"})
    )
    .await
    .is_ok());
    call("smart_checkout", json!({"repo":id,"name":"main"}))
        .await
        .unwrap();
    call("stash_drop", json!({"repo":id,"hash":hash}))
        .await
        .unwrap();
    call(
        "stash_restore",
        json!({"repo":id,"hash":hash,"message":"On main: IPC stash"}),
    )
    .await
    .unwrap();
    call("stash_drop", json!({"repo":id,"hash":hash}))
        .await
        .unwrap();
    call(
        "files_action",
        json!({"repo":id,"paths":["file.txt"],"action":"stage"}),
    )
    .await
    .unwrap();
    let oid = call("commit", json!({"repo":id,"message":"IPC commit"}))
        .await
        .unwrap();
    assert_eq!(oid.as_str().map(str::len), Some(40));
    let progress = Arc::new(Mutex::new(Vec::<Value>::new()));
    let captured = progress.clone();
    app.handle().listen("sync://progress", move |event| {
        captured
            .lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).unwrap());
    });
    call("sync", json!({"repo":id,"action":"fetch"}))
        .await
        .unwrap();
    let completion = progress.lock().unwrap().last().cloned().unwrap();
    assert_eq!(completion["done"], json!(true));
    assert_eq!(completion["message"], json!("fetch complete"));
    assert!(call("sync", json!({"repo":id,"action":"invalid"}))
        .await
        .is_err());
    let failure = progress.lock().unwrap().last().cloned().unwrap();
    assert_eq!(failure["done"], json!(true));
    assert!(failure["message"]
        .as_str()
        .unwrap()
        .starts_with("invalid failed:"));
    assert!(call("system_open", json!({"repo":id,"path":"file.txt"}))
        .await
        .is_err());
    assert!(call("unknown", json!({"repo":id})).await.is_err());
    assert!(call("status", json!({"repo":"missing"})).await.is_err());
    std::fs::write(dir.path().join("picture.png"), b"image bytes").unwrap();
    let mut url = tauri::Url::parse("gitblob://localhost/image").unwrap();
    url.query_pairs_mut()
        .append_pair("repo", id)
        .append_pair("path", "picture.png")
        .append_pair("source", "file")
        .append_pair("side", "new");
    assert_eq!(
        blob::serve(app.handle(), url.to_string()).await.unwrap().0,
        b"image bytes"
    );
    for extension in ["svg", "jpg", "gif", "webp", "bmp", "ico", "avif"] {
        let path = format!("image.{extension}");
        std::fs::write(dir.path().join(&path), b"image").unwrap();
        let mut url = tauri::Url::parse("gitblob://localhost/image").unwrap();
        url.query_pairs_mut()
            .append_pair("repo", id)
            .append_pair("path", &path)
            .append_pair("source", "file");
        assert!(blob::serve(app.handle(), url.to_string())
            .await
            .unwrap()
            .1
            .starts_with("image/"));
    }
    assert!(blob::serve(app.handle(), "not a url".into()).await.is_err());
    let plain = blob::serve(
        app.handle(),
        format!("gitblob://localhost/image?repo={id}&path=file.txt&source=file&side=new"),
    )
    .await
    .unwrap();
    assert_eq!(plain.1, "text/plain; charset=utf-8");
    assert_eq!(plain.0, std::fs::read(dir.path().join("file.txt")).unwrap());
    assert_eq!(blob::mime("archive.tar.gz"), "text/plain; charset=utf-8");
    std::fs::File::create(dir.path().join("large.png"))
        .unwrap()
        .set_len(20 * 1024 * 1024 + 1)
        .unwrap();
    let mut large_url = tauri::Url::parse("http://gitblob.localhost/image").unwrap();
    large_url
        .query_pairs_mut()
        .append_pair("repo", id)
        .append_pair("path", "large.png")
        .append_pair("source", "file");
    assert!(blob::serve(app.handle(), large_url.to_string())
        .await
        .unwrap_err()
        .message
        .starts_with("Image exceeds"));
    std::fs::File::create(dir.path().join("large.txt"))
        .unwrap()
        .set_len(20 * 1024 * 1024 + 1)
        .unwrap();
    assert!(blob::serve(
        app.handle(),
        format!("gitblob://localhost/image?repo={id}&path=large.txt&source=file&side=new")
    )
    .await
    .unwrap_err()
    .message
    .starts_with("File exceeds"));
    call("repo_close", json!({"repo":id})).await.unwrap();
    assert!(app.state::<Registry>().get(id).await.is_err());
}

#[tokio::test]
async fn reads_proceed_while_a_write_holds_the_repository() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    std::fs::write(dir.path().join(".gitignore"), "generated/\n").unwrap();
    std::fs::create_dir(dir.path().join("generated")).unwrap();
    std::fs::write(dir.path().join("file.txt"), "changed\n").unwrap();
    let app = gitviewer_lib::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let call = |command: &str, args: Value| dispatch(app.handle().clone(), command, args);
    let info = call("repo_open", json!({"path":dir.path()})).await.unwrap();
    let id = info["id"].as_str().unwrap();
    let repo = app.state::<Registry>().get(id).await.unwrap();
    let files = Arc::new(Mutex::new(0));
    let counted = files.clone();
    app.handle().listen("repo://files-changed", move |_| {
        *counted.lock().unwrap() += 1;
    });
    let write = repo.writes.lock().await;
    let patient = Duration::from_secs(5);
    for (command, args) in [
        ("status", json!({"repo":id})),
        ("tree", json!({"repo":id,"path":""})),
        (
            "diff",
            json!({"repo":id,"path":"file.txt","source":"unstaged"}),
        ),
        ("stashes", json!({"repo":id})),
    ] {
        timeout(patient, call(command, args))
            .await
            .unwrap()
            .unwrap();
    }
    assert!(timeout(
        Duration::from_millis(200),
        call("refresh", json!({"repo":id}))
    )
    .await
    .is_err());
    drop(write);
    timeout(patient, async {
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        while *files.lock().unwrap() == 0 {
            interval.tick().await;
            std::fs::write(dir.path().join("generated").join("out.js"), "out").unwrap();
        }
    })
    .await
    .unwrap();
}

pub(super) fn app() -> tauri::App<tauri::test::MockRuntime> {
    gitviewer_lib::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
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

#[tokio::test]
async fn patches_travel_only_with_working_tree_sources() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let root = dir.path();
    std::fs::write(root.join("file.txt"), "one\nTWO\nthree\n").unwrap();
    std::fs::write(root.join("staged.txt"), "staged\n").unwrap();
    super::workflows::command(root, &["add", "staged.txt"]).await;
    super::workflows::command(root, &["commit", "-am", "Second"]).await;
    std::fs::write(root.join("staged.txt"), "staged\nmore\n").unwrap();
    super::workflows::command(root, &["add", "staged.txt"]).await;
    std::fs::write(root.join("file.txt"), "one\nTWO\nthree\nfour\n").unwrap();
    let app = app();
    let call = |command: &str, args: Value| dispatch(app.handle().clone(), command, args);
    let info = call("repo_open", json!({"path":root})).await.unwrap();
    let id = info["id"].as_str().unwrap();
    let stash = super::workflows::command(root, &["stash", "create"]).await;
    let stash = stash.trim();
    for (source, path, revision, base) in [
        ("commit", "file.txt", "HEAD", ""),
        ("stash", "file.txt", stash, ""),
        ("compare", "file.txt", "HEAD", "HEAD~1"),
        ("file", "file.txt", "", ""),
    ] {
        let single = call(
            "diff",
            json!({"repo":id,"path":path,"source":source,"revision":revision,"base":base}),
        )
        .await
        .unwrap();
        assert_eq!(single["patches"], json!([]), "{source}");
        if source != "file" {
            assert!(!single["hunks"].as_array().unwrap().is_empty(), "{source}");
            let stack = call(
                "diff_stack",
                json!({"repo":id,"source":source,"revision":revision,"base":base}),
            )
            .await
            .unwrap();
            assert_eq!(stack["files"][path]["patches"], json!([]), "{source}");
        }
    }
    for (source, path) in [("unstaged", "file.txt"), ("staged", "staged.txt")] {
        let single = call("diff", json!({"repo":id,"path":path,"source":source}))
            .await
            .unwrap();
        let stack = call("diff_stack", json!({"repo":id,"source":source}))
            .await
            .unwrap();
        let hunks = single["hunks"].as_array().unwrap().len();
        assert_eq!(hunks, 1);
        assert_eq!(single["patches"].as_array().unwrap().len(), hunks);
        assert!(single["patches"][0]
            .as_str()
            .unwrap()
            .starts_with("diff --git"));
        assert_eq!(stack["files"][path]["patches"], single["patches"]);
    }
    let staged = call(
        "diff",
        json!({"repo":id,"path":"staged.txt","source":"staged"}),
    )
    .await
    .unwrap();
    call(
        "hunk_action",
        json!({"repo":id,"path":"staged.txt","source":"staged","hunk":0,"patch":staged["patches"][0],"action":"unstage"}),
    )
    .await
    .unwrap();
    let unstaged = call(
        "diff",
        json!({"repo":id,"path":"file.txt","source":"unstaged"}),
    )
    .await
    .unwrap();
    call(
        "hunk_action",
        json!({"repo":id,"path":"file.txt","source":"unstaged","hunk":0,"patch":unstaged["patches"][0],"action":"stage"}),
    )
    .await
    .unwrap();
    assert_eq!(
        super::workflows::command(root, &["diff", "--cached", "--name-only"])
            .await
            .trim(),
        "file.txt"
    );
    let status = call("status", json!({"repo":id})).await.unwrap();
    for entry in status["entries"].as_array().unwrap() {
        let mut keys: Vec<&str> = entry
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        if entry["kind"] == "ordinary" {
            assert_eq!(keys, ["index", "kind", "path", "worktree"]);
        }
    }
}

#[tokio::test]
async fn refresh_reads_status_once_and_reports_head_moves() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
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
    let trace = dir.path().join("..").join(format!(
        "{}-refresh-trace.json",
        dir.path().file_name().unwrap().to_string_lossy()
    ));
    std::env::set_var("GIT_TRACE2_EVENT", &trace);
    let refresh = || async {
        dispatch(app.handle().clone(), "refresh", json!({"repo":id}))
            .await
            .unwrap()
    };
    let processes = super::workflows::counted(&trace, refresh()).await;
    std::env::remove_var("GIT_TRACE2_EVENT");
    std::fs::remove_file(&trace).ok();
    assert_eq!(processes, 1);
    assert_eq!((read(&status), read(&head)), (1, 0));
    refresh().await;
    assert_eq!((read(&status), read(&head)), (2, 0));
    super::workflows::command(root, &["commit", "--allow-empty", "-m", "Moved"]).await;
    refresh().await;
    assert_eq!((read(&status), read(&head)), (3, 1));
    super::workflows::command(root, &["checkout", "-q", "-b", "other"]).await;
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
    base(&dir, &handle).await;
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
    let call = |command: &str, args: Value| dispatch(app.handle().clone(), command, args);
    let hash = call("stash_save", json!({"repo":id,"message":"Saved"}))
        .await
        .unwrap();
    assert_eq!(read(&head), 1);
    call(
        "stash_apply",
        json!({"repo":id,"hash":hash,"pop":false,"smart":false}),
    )
    .await
    .unwrap();
    assert_eq!(read(&head), 2);
    call("stash_drop", json!({"repo":id,"hash":hash}))
        .await
        .unwrap();
    assert_eq!(read(&head), 3);
    call(
        "stash_restore",
        json!({"repo":id,"hash":hash,"message":"On main: Saved"}),
    )
    .await
    .unwrap();
    assert_eq!(read(&head), 4);
}
