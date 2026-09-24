use super::workflows::{base, fixture};
use gitviewer_lib::{
    edit::{self, Opened, Written},
    ipc,
};
use serde_json::{json, Value};

fn saved(written: Written) -> String {
    match written {
        Written::Saved(version) => version,
        Written::Conflict(current) => panic!("unexpected conflict: {current:?}"),
    }
}

#[tokio::test]
async fn reads_normalise_line_endings_and_refuse_non_text() {
    let (dir, handle) = fixture().await;
    let repo = handle.lock().await;
    std::fs::write(dir.path().join("plain.txt"), "one\ntwo\n").unwrap();
    std::fs::write(dir.path().join("windows.txt"), "\u{feff}one\r\ntwo\r\n").unwrap();
    std::fs::write(dir.path().join("binary.bin"), [0x61, 0, 0x62]).unwrap();
    std::fs::write(dir.path().join("latin1.txt"), [0x63, 0x61, 0x66, 0xe9]).unwrap();
    std::fs::write(dir.path().join("large.txt"), "x".repeat(3 * 1024 * 1024)).unwrap();
    std::fs::write(dir.path().join("long.txt"), "\n".repeat(50_001)).unwrap();
    let plain = edit::read(&repo, "plain.txt").unwrap().unwrap();
    assert_eq!(plain.text, "one\ntwo\n");
    assert!(!plain.bom && !plain.crlf);
    let windows = edit::read(&repo, "windows.txt").unwrap().unwrap();
    assert_eq!(windows.text, "one\ntwo\n");
    assert!(windows.bom && windows.crlf);
    assert_ne!(plain.version, windows.version);
    for path in [
        "binary.bin",
        "latin1.txt",
        "large.txt",
        "long.txt",
        "missing.txt",
    ] {
        assert_eq!(edit::read(&repo, path).unwrap(), None, "{path}");
    }
    assert!(edit::read(&repo, "../outside.txt").is_err());
    assert!(edit::read(&repo, ".git/config").is_err());
}

#[tokio::test]
async fn writes_keep_the_file_shape_and_detect_conflicts() {
    let (dir, handle) = fixture().await;
    let repo = handle.lock().await;
    let path = dir.path().join("windows.txt");
    std::fs::write(&path, "\u{feff}one\r\ntwo\r\n").unwrap();
    let opened = edit::read(&repo, "windows.txt").unwrap().unwrap();
    let version = saved(
        edit::write(
            &repo,
            "windows.txt",
            "one\ntwo\nthree\n",
            Some(&opened.version),
        )
        .unwrap(),
    );
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "\u{feff}one\r\ntwo\r\nthree\r\n"
    );
    assert_eq!(
        edit::read(&repo, "windows.txt").unwrap().unwrap().version,
        version
    );
    std::fs::write(&path, "changed elsewhere\r\n").unwrap();
    assert_eq!(
        edit::write(&repo, "windows.txt", "mine\n", Some(&version)).unwrap(),
        Written::Conflict(Some(Opened {
            text: "changed elsewhere\n".into(),
            version: edit::read(&repo, "windows.txt").unwrap().unwrap().version,
            bom: false,
            crlf: true,
        }))
    );
    std::fs::remove_file(&path).unwrap();
    assert_eq!(
        edit::write(&repo, "windows.txt", "mine\n", Some(&version)).unwrap(),
        Written::Conflict(None)
    );
    saved(edit::write(&repo, "windows.txt", "mine\n", None).unwrap());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "mine\n");
    assert!(matches!(
        edit::write(&repo, "windows.txt", "again\n", None).unwrap(),
        Written::Conflict(Some(_))
    ));
    assert!(edit::write(&repo, "../outside.txt", "x", None).is_err());
}

#[tokio::test]
async fn file_commands_round_trip_and_refresh_status() {
    let (dir, handle) = fixture().await;
    base(&dir, &handle).await;
    let app = gitviewer_lib::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let call =
        |command: &str, args: Value| ipc::dispatch(app.handle().clone(), command.to_string(), args);
    let info = call("repo_open", json!({"path":dir.path()})).await.unwrap();
    let id = info["id"].as_str().unwrap();
    let opened = call("file_read", json!({"repo":id,"path":"file.txt"}))
        .await
        .unwrap();
    assert_eq!(opened["text"], json!("one\ntwo\nthree\n"));
    let written = call(
        "file_write",
        json!({"repo":id,"path":"file.txt","content":"one\n","expected":opened["version"]}),
    )
    .await
    .unwrap();
    assert!(written["saved"].is_string());
    let status = call("status", json!({"repo":id})).await.unwrap();
    assert_eq!(status["entries"][0]["path"], json!("file.txt"));
    let conflict = call(
        "file_write",
        json!({"repo":id,"path":"file.txt","content":"two\n","expected":opened["version"]}),
    )
    .await
    .unwrap();
    assert_eq!(conflict["conflict"]["text"], json!("one\n"));
    assert!(call("file_write", json!({"repo":id,"path":"file.txt"}))
        .await
        .is_err());
}
