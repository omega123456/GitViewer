use crate::{
    error::{Error, Result},
    settings::Settings,
};
use serde::Serialize;
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};
use tokio::sync::{Mutex as AsyncMutex, Notify};

#[cfg(not(feature = "test-utils"))]
mod native;

pub type Task<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;
pub type Progress<'a> = Box<dyn Fn(usize, Option<u64>) + Send + Sync + 'a>;

pub trait Release: Send + Sync {
    fn summary(&self) -> Summary;
    fn download<'a>(&'a self, progress: Progress<'a>) -> Task<'a, Vec<u8>>;
    fn install(&self, bytes: &[u8], restart: bool) -> Result<()>;
}
pub trait Backend: Send + Sync {
    fn check(&self) -> Task<'_, Option<Box<dyn Release>>>;
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Availability {
    Enabled,
    Development,
    Unconfigured,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    Saving,
    Installing,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub current_version: String,
    pub availability: Availability,
    pub available: Option<Summary>,
    pub last_checked: Option<String>,
    pub phase: Phase,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
    pub can_quit_without_updating: bool,
}

#[derive(Default)]
struct Pending {
    release: Option<Box<dyn Release>>,
    bytes: Option<Vec<u8>>,
}

#[derive(Clone, Copy, Default, PartialEq)]
enum Intent {
    #[default]
    Quit,
    Restart,
    Skip,
}

pub struct Service {
    snapshot: Mutex<Snapshot>,
    settings: Mutex<Settings>,
    intent: Mutex<Intent>,
    pending: AsyncMutex<Pending>,
    backend: Option<Box<dyn Backend>>,
    changed: Box<dyn Fn() + Send + Sync>,
    wake: Notify,
}

impl Service {
    pub fn new(
        version: String,
        availability: Availability,
        settings: Settings,
        backend: Option<Box<dyn Backend>>,
        changed: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        Self {
            snapshot: Mutex::new(Snapshot {
                current_version: version,
                availability,
                available: None,
                last_checked: None,
                phase: Phase::Idle,
                downloaded: 0,
                total: None,
                error: None,
                can_quit_without_updating: false,
            }),
            settings: Mutex::new(settings),
            intent: Mutex::new(Intent::Quit),
            pending: AsyncMutex::new(Pending::default()),
            backend,
            changed: Box::new(changed),
            wake: Notify::new(),
        }
    }
    pub fn get(&self) -> Snapshot {
        self.snapshot.lock().unwrap().clone()
    }
    fn change(&self, update: impl FnOnce(&mut Snapshot)) {
        update(&mut self.snapshot.lock().unwrap());
        (self.changed)();
    }
    pub fn preferences(&self, settings: Settings) {
        let mut current = self.settings.lock().unwrap();
        let changed = current.update_check_interval != settings.update_check_interval
            || current.install_update_on_quit != settings.install_update_on_quit;
        *current = settings;
        if changed {
            self.wake.notify_one();
        }
    }
    fn fail(&self, error: Error) -> Error {
        self.change(|state| {
            state.phase = Phase::Error;
            state.error = Some(error.message.clone());
        });
        error
    }
    async fn download(&self, pending: &mut Pending) -> Result<()> {
        if pending.bytes.is_some() {
            return Ok(());
        }
        let release = pending
            .release
            .as_ref()
            .ok_or_else(|| Error::refused("No update is available"))?;
        self.change(|state| {
            state.phase = Phase::Downloading;
            state.downloaded = 0;
            state.total = None;
            state.error = None;
        });
        let bytes = release
            .download(Box::new(|chunk, total| {
                self.change(|state| {
                    state.downloaded += chunk as u64;
                    state.total = total;
                })
            }))
            .await
            .map_err(|error| self.fail(error))?;
        pending.bytes = Some(bytes);
        self.change(|state| state.phase = Phase::Ready);
        Ok(())
    }
    pub async fn check(&self) -> Result<()> {
        let Some(backend) = self
            .backend
            .as_ref()
            .filter(|_| self.get().availability == Availability::Enabled)
        else {
            return Err(Error::refused("Updates are unavailable in this build"));
        };
        let Ok(mut pending) = self.pending.try_lock() else {
            return Ok(());
        };
        if *self.intent.lock().unwrap() != Intent::Quit {
            return Ok(());
        }
        self.change(|state| {
            state.phase = Phase::Checking;
            state.error = None;
        });
        let release = backend.check().await.map_err(|error| self.fail(error))?;
        let unchanged = release
            .as_ref()
            .zip(pending.release.as_ref())
            .is_some_and(|(next, previous)| next.summary() == previous.summary());
        if !unchanged {
            pending.bytes = None;
        }
        self.change(|state| {
            state.last_checked = Some(chrono::Utc::now().to_rfc3339());
            state.available = release.as_ref().map(|item| item.summary());
            state.phase = if pending.bytes.is_some() {
                Phase::Ready
            } else if release.is_some() {
                Phase::Available
            } else {
                Phase::Idle
            };
        });
        if !unchanged {
            pending.release = release;
        }
        if pending.release.is_some() && self.settings.lock().unwrap().install_update_on_quit {
            self.download(&mut pending).await?;
        }
        Ok(())
    }
    pub async fn prepare_install(&self) -> Result<()> {
        if self.get().availability != Availability::Enabled {
            return Err(Error::refused("Updates are unavailable in this build"));
        }
        let mut pending = self
            .pending
            .try_lock()
            .map_err(|_| Error::refused("An update operation is already running"))?;
        if *self.intent.lock().unwrap() != Intent::Quit {
            return Err(Error::refused("The application is already closing"));
        }
        self.download(&mut pending).await?;
        *self.intent.lock().unwrap() = Intent::Restart;
        self.change(|state| {
            state.phase = Phase::Saving;
            state.error = None;
        });
        Ok(())
    }
    pub fn skip_install(&self) -> Result<()> {
        if !self.get().can_quit_without_updating {
            return Err(Error::refused("No failed installation to skip"));
        }
        *self.intent.lock().unwrap() = Intent::Skip;
        Ok(())
    }
    pub fn cancel_close(&self) {
        *self.intent.lock().unwrap() = Intent::Quit;
        self.change(|state| {
            if state.phase == Phase::Saving {
                state.phase = Phase::Ready;
            }
        });
    }
    pub fn finish_close(&self) -> Result<bool> {
        let intent = *self.intent.lock().unwrap();
        let restart = intent == Intent::Restart;
        let automatic = self.settings.lock().unwrap().install_update_on_quit;
        if intent == Intent::Skip || (!restart && !automatic) {
            return Ok(false);
        }
        let Ok(pending) = self.pending.try_lock() else {
            return Ok(false);
        };
        if let (Some(release), Some(bytes)) = (&pending.release, &pending.bytes) {
            self.change(|state| state.phase = Phase::Installing);
            if let Err(error) = release.install(bytes, restart) {
                *self.intent.lock().unwrap() = Intent::Quit;
                self.change(|state| state.can_quit_without_updating = true);
                return Err(self.fail(error));
            }
            return Ok(restart);
        }
        Ok(false)
    }
    pub async fn run(self: Arc<Self>) {
        if self.get().availability != Availability::Enabled {
            return;
        }
        loop {
            if interval(&self.settings.lock().unwrap().update_check_interval).is_some() {
                if let Err(error) = self.check().await {
                    tracing::warn!(%error, "Automatic update check failed");
                }
            } else if self.settings.lock().unwrap().install_update_on_quit {
                if let Ok(mut pending) = self.pending.try_lock() {
                    if pending.release.is_some()
                        && pending.bytes.is_none()
                        && *self.intent.lock().unwrap() == Intent::Quit
                    {
                        if let Err(error) = self.download(&mut pending).await {
                            tracing::warn!(%error, "Automatic update download failed");
                        }
                    }
                }
            }
            let delay = interval(&self.settings.lock().unwrap().update_check_interval);
            match delay {
                Some(delay) => {
                    tokio::select! { _ = tokio::time::sleep(delay) => {}, _ = self.wake.notified() => {} }
                }
                None => self.wake.notified().await,
            }
        }
    }
}

pub fn interval(value: &str) -> Option<std::time::Duration> {
    let duration = match value {
        "1h" => chrono::Duration::hours(1),
        "5h" => chrono::Duration::hours(5),
        "1d" => chrono::Duration::days(1),
        "7d" => chrono::Duration::days(7),
        _ => return None,
    };
    duration.to_std().ok()
}

pub fn setup<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<()> {
    use tauri::{Emitter, Manager};
    #[cfg(not(feature = "test-utils"))]
    let (availability, backend, settings) = native::configure(app)?;
    #[cfg(feature = "test-utils")]
    let (availability, backend, settings) = (Availability::Development, None, Settings::default());
    let handle = app.clone();
    let service = Arc::new(Service::new(
        app.package_info().version.to_string(),
        availability,
        settings,
        backend,
        move || {
            let _ = handle.emit("update://changed", ());
        },
    ));
    app.manage(service.clone());
    tauri::async_runtime::spawn(service.run());
    Ok(())
}
