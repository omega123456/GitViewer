use gitviewer_lib::{
    logging,
    session::{Geometry, Store, Tab},
    settings,
};

#[test]
fn session_round_trip_preserves_geometry_tabs_and_drafts() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested/session.json");
    let store = Store::load(path.clone());
    store.update(
        vec![Tab {
            path: "/repo".into(),
            message: "draft".into(),
        }],
        "/repo".into(),
    );
    store.geometry(Geometry {
        x: -400,
        y: 20,
        width: 1200,
        height: 800,
        maximized: true,
    });
    store.save().unwrap();
    assert_eq!(Store::load(path.clone()).get(), store.get());
    store.update(vec![], String::new());
    store.save().unwrap();
    assert!(Store::load(path.clone()).get().tabs.is_empty());
    assert!(Store::load(path).get().window.unwrap().maximized);
    assert!(!directory.path().join("nested/session.json.tmp").exists());
}

#[test]
fn persistence_handles_missing_corrupt_and_unwritable_files() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.json");
    std::fs::write(&path, "invalid json").unwrap();
    assert!(Store::load(path.clone()).get().tabs.is_empty());
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(Store::load(path).save().is_err());
    Store::default().save().unwrap();
    let settings_path = directory.path().join("settings.json");
    let preferences = settings::Settings {
        theme: "dark".into(),
        density: "compact".into(),
        diff_mode: "unified".into(),
    };
    settings::write(&settings_path, preferences.clone()).unwrap();
    assert_eq!(settings::read(&settings_path), preferences);
}

#[test]
fn logs_only_remove_expired_application_files() {
    let directory = tempfile::tempdir().unwrap();
    for name in [
        "gitviewer.2026-09-01.log",
        "gitviewer.2026-09-02.log",
        "gitviewer.invalid.log",
        "other.2026-09-01.log",
    ] {
        std::fs::write(directory.path().join(name), "log").unwrap();
    }
    logging::cleanup(
        directory.path(),
        chrono::NaiveDate::from_ymd_opt(2026, 9, 9).unwrap(),
    )
    .unwrap();
    assert!(!directory.path().join("gitviewer.2026-09-01.log").exists());
    for name in [
        "gitviewer.2026-09-02.log",
        "gitviewer.invalid.log",
        "other.2026-09-01.log",
    ] {
        assert!(directory.path().join(name).exists());
    }
}

#[test]
fn logging_flushes_daily_files() {
    let directory = tempfile::tempdir().unwrap();
    let guard = logging::init(directory.path()).unwrap();
    tracing::info!("Persistence logging test");
    guard.flush();
    guard.flush();
    drop(guard);
    let contents: String = std::fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
        .collect();
    assert!(contents.contains("Persistence logging test"));
}

#[tokio::test]
async fn session_commands_are_isolated_and_preserve_native_geometry() {
    use gitviewer_lib::{ipc, lifecycle};
    use serde_json::json;
    use tauri::Manager;
    let app = gitviewer_lib::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let store = app.state::<Store>();
    store.geometry(Geometry {
        x: 10,
        y: 20,
        width: 1200,
        height: 800,
        maximized: false,
    });
    ipc::dispatch(
        app.handle().clone(),
        "session_set".into(),
        json!({"tabs":[{"path":"/repo","message":"draft"}],"active":"/repo"}),
    )
    .await
    .unwrap();
    let state = ipc::dispatch(app.handle().clone(), "session_get".into(), json!({}))
        .await
        .unwrap();
    assert_eq!(state["active"], "/repo");
    assert_eq!(state["window"]["width"], 1200);
    ipc::dispatch(
        app.handle().clone(),
        "frontend_log".into(),
        json!({"message":"Test frontend error"}),
    )
    .await
    .unwrap();
    lifecycle::flush(app.handle());
    assert_eq!(store.get().tabs.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn autosave_and_close_flush_the_latest_snapshot() {
    use gitviewer_lib::{ipc, lifecycle};
    use serde_json::json;
    use tauri::{Listener, Manager};
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.json");
    let app = tauri::test::mock_builder()
        .manage(Store::load(path.clone()))
        .manage(gitviewer_lib::repo::Registry::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let store = app.state::<Store>();
    ipc::dispatch(
        app.handle().clone(),
        "session_set".into(),
        json!({"tabs":[{"path":"/repo","message":"autosaved"}],"active":"/repo"}),
    )
    .await
    .unwrap();
    assert!(!path.exists());
    let autosave = tokio::spawn(lifecycle::autosave(app.handle().clone()));
    tokio::task::yield_now().await;
    tokio::time::advance(chrono::Duration::minutes(4).to_std().unwrap()).await;
    assert!(!path.exists());
    tokio::time::advance(chrono::Duration::minutes(1).to_std().unwrap()).await;
    tokio::task::yield_now().await;
    assert_eq!(Store::load(path.clone()).get().tabs[0].message, "autosaved");
    autosave.abort();
    let requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let captured = requests.clone();
    app.listen("session://save-requested", move |_| {
        captured.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    });
    assert!(!lifecycle::request_close(app.handle()));
    assert!(!lifecycle::request_close(app.handle()));
    assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 1);
    ipc::dispatch(
        app.handle().clone(),
        "session_close".into(),
        json!({"tabs":[{"path":"/repo","message":"final keystroke"}],"active":"/repo"}),
    )
    .await
    .unwrap();
    assert_eq!(Store::load(path).get().tabs[0].message, "final keystroke");
    assert!(store.close_allowed());
    assert!(lifecycle::request_close(app.handle()));
}

#[tokio::test(start_paused = true)]
async fn close_timeout_preserves_saved_state_and_failed_saves_cancel_exit() {
    use gitviewer_lib::lifecycle;
    use tauri::Manager;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.json");
    let app = tauri::test::mock_builder()
        .manage(Store::load(path.clone()))
        .manage(gitviewer_lib::repo::Registry::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let store = app.state::<Store>();
    store.update(
        vec![Tab {
            path: "/repo".into(),
            message: "last known".into(),
        }],
        "/repo".into(),
    );
    assert!(store.begin_close());
    lifecycle::close_timeout(app.handle().clone()).await;
    assert!(store.close_allowed());
    assert_eq!(
        Store::load(path.clone()).get().tabs[0].message,
        "last known"
    );
    store.cancel_close();
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(store.begin_close());
    assert!(lifecycle::complete_close(app.handle()).is_err());
    assert!(!store.close_allowed());
    assert!(store.begin_close());
    lifecycle::close_timeout(app.handle().clone()).await;
    assert!(!store.close_allowed());
    lifecycle::flush(app.handle());
}
