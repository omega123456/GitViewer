use gitviewer_lib::{
    error::{Error, Result},
    settings::Settings,
    updater::{Availability, Backend, Phase, Progress, Release, Service, Summary, Task},
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

#[derive(Default)]
struct Fake {
    checks: AtomicUsize,
    downloads: AtomicUsize,
    installs: Mutex<Vec<bool>>,
    failure: Mutex<String>,
    absent: Mutex<bool>,
    newer: Mutex<bool>,
    saved_session: Mutex<Option<std::path::PathBuf>>,
    block: tokio::sync::Notify,
    delayed: Mutex<bool>,
}
struct Source(Arc<Fake>);
struct Offer(Arc<Fake>, String);
impl Backend for Source {
    fn check(&self) -> Task<'_, Option<Box<dyn Release>>> {
        Box::pin(async move {
            self.0.checks.fetch_add(1, Ordering::SeqCst);
            if *self.0.delayed.lock().unwrap() {
                self.0.block.notified().await;
            }
            if *self.0.failure.lock().unwrap() == "check" {
                return Err(Error::refused("Offline"));
            }
            if *self.0.absent.lock().unwrap() {
                Ok(None)
            } else {
                Ok(Some(Box::new(Offer(
                    self.0.clone(),
                    if *self.0.newer.lock().unwrap() {
                        "0.3.0"
                    } else {
                        "0.2.0"
                    }
                    .into(),
                )) as Box<dyn Release>))
            }
        })
    }
}
impl Release for Offer {
    fn summary(&self) -> Summary {
        Summary {
            version: self.1.clone(),
            notes: Some("Release notes".into()),
            date: None,
        }
    }
    fn download<'a>(&'a self, progress: Progress<'a>) -> Task<'a, Vec<u8>> {
        Box::pin(async move {
            self.0.downloads.fetch_add(1, Ordering::SeqCst);
            progress(2, Some(4));
            if *self.0.failure.lock().unwrap() == "download" {
                return Err(Error::refused("Invalid signature"));
            }
            progress(2, Some(4));
            Ok(vec![1, 2, 3, 4])
        })
    }
    fn install(&self, bytes: &[u8], restart: bool) -> Result<()> {
        assert_eq!(bytes, &[1, 2, 3, 4]);
        if let Some(path) = self.0.saved_session.lock().unwrap().as_ref() {
            let saved = gitviewer_lib::session::Store::load(path.clone());
            assert_eq!(saved.get().tabs[0].message, "final draft");
        }
        self.0.installs.lock().unwrap().push(restart);
        if *self.0.failure.lock().unwrap() == "install" {
            return Err(Error::refused("Installer failed"));
        }
        Ok(())
    }
}
fn service(automatic: bool) -> (Arc<Service>, Arc<Fake>) {
    let fake = Arc::new(Fake::default());
    let service = Arc::new(Service::new(
        "0.1.0".into(),
        Availability::Enabled,
        Settings {
            install_update_on_quit: automatic,
            ..Default::default()
        },
        Some(Box::new(Source(fake.clone()))),
        || {},
    ));
    (service, fake)
}

#[tokio::test]
async fn checks_downloads_and_install_intents_are_serialized() {
    let (service, fake) = service(true);
    assert!(service.prepare_install().await.is_err());
    assert!(service.skip_install().is_err());
    assert!(!service.finish_close().unwrap());
    service.check().await.unwrap();
    assert_eq!(service.get().phase, Phase::Ready);
    assert_eq!(service.get().downloaded, 4);
    assert!(service.get().last_checked.is_some());
    service.check().await.unwrap();
    assert_eq!(fake.checks.load(Ordering::SeqCst), 2);
    assert_eq!(fake.downloads.load(Ordering::SeqCst), 1);
    assert!(!service.finish_close().unwrap());
    assert_eq!(*fake.installs.lock().unwrap(), vec![false]);
    service.prepare_install().await.unwrap();
    assert_eq!(service.get().phase, Phase::Saving);
    assert!(service.prepare_install().await.is_err());
    service.check().await.unwrap();
    assert!(service.finish_close().unwrap());
    assert_eq!(*fake.installs.lock().unwrap(), vec![false, true]);
    service.cancel_close();
}

#[tokio::test]
async fn preferences_disable_pending_install_and_manual_checks_still_work() {
    let (service, fake) = service(false);
    service.check().await.unwrap();
    assert_eq!(service.get().phase, Phase::Available);
    assert_eq!(fake.downloads.load(Ordering::SeqCst), 0);
    service.prepare_install().await.unwrap();
    service.cancel_close();
    assert_eq!(service.get().phase, Phase::Ready);
    assert!(!service.finish_close().unwrap());
    assert!(fake.installs.lock().unwrap().is_empty());
    service.preferences(Settings {
        update_check_interval: "off".into(),
        ..Default::default()
    });
    assert!(!service.finish_close().unwrap());
    assert_eq!(fake.installs.lock().unwrap().len(), 1);
    service.preferences(Settings {
        install_update_on_quit: false,
        ..Default::default()
    });
    assert!(!service.finish_close().unwrap());
    assert_eq!(fake.installs.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn failed_checks_downloads_and_installs_can_be_retried_or_skipped() {
    let (service, fake) = service(true);
    *fake.failure.lock().unwrap() = "check".into();
    assert!(service.check().await.is_err());
    assert!(service.get().last_checked.is_none());
    *fake.failure.lock().unwrap() = "download".into();
    assert!(service.check().await.is_err());
    assert_eq!(service.get().error.as_deref(), Some("Invalid signature"));
    assert!(!service.finish_close().unwrap());
    *fake.failure.lock().unwrap() = String::new();
    service.prepare_install().await.unwrap();
    assert_eq!(fake.downloads.load(Ordering::SeqCst), 2);
    *fake.failure.lock().unwrap() = "install".into();
    assert!(service.finish_close().is_err());
    assert!(service.get().can_quit_without_updating);
    service.skip_install().unwrap();
    assert!(!service.finish_close().unwrap());
    service.check().await.unwrap();
    service.cancel_close();
    *fake.failure.lock().unwrap() = String::new();
    service.prepare_install().await.unwrap();
    assert!(service.finish_close().unwrap());
}

#[tokio::test]
async fn busy_checks_do_not_duplicate_work_or_delay_quit() {
    let (service, fake) = service(true);
    *fake.delayed.lock().unwrap() = true;
    let running = tokio::spawn({
        let service = service.clone();
        async move { service.check().await }
    });
    tokio::task::yield_now().await;
    service.check().await.unwrap();
    assert!(service.prepare_install().await.is_err());
    assert!(!service.finish_close().unwrap());
    assert_eq!(fake.checks.load(Ordering::SeqCst), 1);
    fake.block.notify_one();
    running.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn scheduler_checks_at_startup_and_obeys_frequency_and_off() {
    let (service, fake) = service(false);
    *fake.absent.lock().unwrap() = true;
    let running = tokio::spawn(service.clone().run());
    tokio::task::yield_now().await;
    assert_eq!(fake.checks.load(Ordering::SeqCst), 1);
    tokio::time::advance(chrono::Duration::days(1).to_std().unwrap()).await;
    tokio::task::yield_now().await;
    assert_eq!(fake.checks.load(Ordering::SeqCst), 2);
    service.preferences(Settings {
        update_check_interval: "off".into(),
        ..Default::default()
    });
    tokio::task::yield_now().await;
    tokio::time::advance(chrono::Duration::days(7).to_std().unwrap()).await;
    assert_eq!(fake.checks.load(Ordering::SeqCst), 2);
    service.check().await.unwrap();
    assert_eq!(fake.checks.load(Ordering::SeqCst), 3);
    *fake.failure.lock().unwrap() = "check".into();
    service.preferences(Settings {
        update_check_interval: "1h".into(),
        ..Default::default()
    });
    tokio::task::yield_now().await;
    assert_eq!(service.get().phase, Phase::Error);
    running.abort();
    for (value, duration) in [
        ("1h", chrono::Duration::hours(1)),
        ("5h", chrono::Duration::hours(5)),
        ("1d", chrono::Duration::days(1)),
        ("7d", chrono::Duration::days(7)),
    ] {
        assert_eq!(
            gitviewer_lib::updater::interval(value),
            Some(duration.to_std().unwrap())
        );
    }
}

#[tokio::test]
async fn development_and_missing_configuration_never_access_the_backend() {
    for availability in [Availability::Development, Availability::Unconfigured] {
        let service = Arc::new(Service::new(
            "0.1.0".into(),
            availability,
            Settings::default(),
            None,
            || {},
        ));
        assert!(service.check().await.is_err());
        assert!(service.prepare_install().await.is_err());
        service.run().await;
    }
    let app = gitviewer_lib::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    gitviewer_lib::updater::setup(app.handle()).unwrap();
    let result = gitviewer_lib::ipc::dispatch(
        app.handle().clone(),
        "update_get".into(),
        serde_json::json!({}),
    )
    .await
    .unwrap();
    assert_eq!(result["availability"], "development");
    for command in ["update_check", "update_install", "update_quit"] {
        assert!(gitviewer_lib::ipc::dispatch(
            app.handle().clone(),
            command.into(),
            serde_json::json!({})
        )
        .await
        .is_err());
    }
}

#[tokio::test]
async fn lifecycle_saves_before_install_and_failed_saves_never_install() {
    use gitviewer_lib::{lifecycle, session::Store};
    use tauri::Manager;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.json");
    let (service, fake) = service(true);
    service.check().await.unwrap();
    let app = tauri::test::mock_builder()
        .manage(Store::load(path.clone()))
        .manage(service.clone())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let store = app.state::<Store>();
    *fake.saved_session.lock().unwrap() = Some(path.clone());
    store.update(
        vec![gitviewer_lib::session::Tab {
            path: "/repo".into(),
            message: "final draft".into(),
            layout: None,
        }],
        "/repo".into(),
    );
    std::fs::create_dir(&path).unwrap();
    service.prepare_install().await.unwrap();
    assert!(store.begin_close());
    assert!(lifecycle::complete_close(app.handle()).is_err());
    assert!(fake.installs.lock().unwrap().is_empty());
    assert_eq!(service.get().phase, Phase::Ready);
    std::fs::remove_dir(&path).unwrap();
    *fake.failure.lock().unwrap() = "install".into();
    assert!(store.begin_close());
    assert!(lifecycle::complete_close(app.handle()).is_err());
    assert!(path.is_file());
    assert!(!store.close_allowed());
    *fake.failure.lock().unwrap() = String::new();
    service.prepare_install().await.unwrap();
    assert!(store.begin_close());
    lifecycle::complete_close(app.handle()).unwrap();
    assert!(store.close_allowed());
    lifecycle::complete_close(app.handle()).unwrap();
    assert_eq!(*fake.installs.lock().unwrap(), vec![false, true]);
}

#[test]
fn old_settings_receive_update_defaults_and_invalid_intervals_are_rejected() {
    let settings: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
    assert_eq!(settings.update_check_interval, "1d");
    assert!(settings.install_update_on_quit);
    let directory = tempfile::tempdir().unwrap();
    assert!(gitviewer_lib::settings::write(
        &directory.path().join("settings.json"),
        Settings {
            update_check_interval: "bad".into(),
            ..settings
        }
    )
    .is_err());
}

#[tokio::test]
async fn a_newer_or_withdrawn_release_replaces_the_cached_offer() {
    let (service, fake) = service(true);
    service.check().await.unwrap();
    *fake.newer.lock().unwrap() = true;
    service.check().await.unwrap();
    assert_eq!(service.get().available.unwrap().version, "0.3.0");
    assert_eq!(fake.downloads.load(Ordering::SeqCst), 2);
    *fake.absent.lock().unwrap() = true;
    service.check().await.unwrap();
    assert!(service.get().available.is_none());
    assert!(!service.finish_close().unwrap());
}

#[tokio::test(start_paused = true)]
async fn enabling_install_on_quit_downloads_a_known_offer_even_with_checks_off() {
    let (service, fake) = service(false);
    service.preferences(Settings {
        update_check_interval: "off".into(),
        install_update_on_quit: false,
        ..Default::default()
    });
    service.check().await.unwrap();
    let running = tokio::spawn(service.clone().run());
    tokio::task::yield_now().await;
    service.preferences(Settings {
        theme: "dark".into(),
        update_check_interval: "off".into(),
        install_update_on_quit: false,
        ..Default::default()
    });
    tokio::task::yield_now().await;
    assert_eq!(fake.downloads.load(Ordering::SeqCst), 0);
    service.preferences(Settings {
        update_check_interval: "off".into(),
        ..Default::default()
    });
    tokio::task::yield_now().await;
    assert_eq!(fake.downloads.load(Ordering::SeqCst), 1);
    assert_eq!(fake.checks.load(Ordering::SeqCst), 1);
    assert_eq!(service.get().phase, Phase::Ready);
    running.abort();
}
