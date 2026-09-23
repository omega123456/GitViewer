use super::workflows::{base, fixture};
use gitviewer_lib::{blob, ipc, repo::Registry};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{Listener, Manager};

#[tokio::test]
async fn typed_commands_events_and_protocol_are_wired() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let app = gitviewer_lib::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let call =
        |command: &str, args: Value| ipc::dispatch(app.handle().clone(), command.to_string(), args);
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
        json!({"file.txt":"A"})
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
    call("branch_merge", json!({"repo":id,"name":"feature"}))
        .await
        .unwrap();
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
        "files_action",
        json!({"repo":id,"paths":["file.txt"],"action":"stage"}),
    )
    .await
    .unwrap();
    call("commit", json!({"repo":id,"message":"IPC commit"}))
        .await
        .unwrap();
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
