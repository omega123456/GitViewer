use crate::{
    error::{Error, Result},
    lock::lock_recovering,
    settings::{Settings, UpdateInterval},
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

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}
impl DownloadProgress {
    fn received(self, chunk: usize, total: Option<u64>) -> Self {
        Self {
            downloaded: self.downloaded + u64::try_from(chunk).unwrap_or(u64::MAX),
            total,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub current_version: String,
    pub availability: Availability,
    pub available: Option<Summary>,
    pub last_checked: Option<String>,
    pub phase: Phase,
    #[serde(flatten)]
    pub progress: DownloadProgress,
    pub error: Option<String>,
    pub can_quit_without_updating: bool,
}
impl Snapshot {
    fn new(current_version: String, availability: Availability) -> Self {
        Self {
            current_version,
            availability,
            available: None,
            last_checked: None,
            phase: Phase::Idle,
            progress: DownloadProgress::default(),
            error: None,
            can_quit_without_updating: false,
        }
    }
    fn enter(&mut self, phase: Phase) {
        self.phase = phase;
        self.error = None;
    }
    fn failed(&mut self, message: String) {
        self.phase = Phase::Error;
        self.error = Some(message);
    }
    fn downloading(&mut self) {
        self.enter(Phase::Downloading);
        self.progress = DownloadProgress::default();
    }
    fn received(&mut self, chunk: usize, total: Option<u64>) {
        self.progress = self.progress.received(chunk, total);
    }
    fn downloaded(&mut self) {
        self.phase = Phase::Ready;
    }
    fn checked(&mut self, available: Option<Summary>, ready: bool) {
        self.last_checked = Some(chrono::Utc::now().to_rfc3339());
        self.phase = checked_phase(available.is_some(), ready);
        self.available = available;
    }
    fn close_cancelled(&mut self) {
        if self.phase == Phase::Saving {
            self.phase = Phase::Ready;
        }
    }
    fn installing(&mut self) {
        self.phase = Phase::Installing;
    }
    fn install_failed(&mut self) {
        self.can_quit_without_updating = true;
    }
}
fn checked_phase(available: bool, ready: bool) -> Phase {
    if ready {
        return Phase::Ready;
    }
    if available {
        return Phase::Available;
    }
    Phase::Idle
}

struct PendingRelease {
    release: Box<dyn Release>,
    bytes: Option<Vec<u8>>,
}
impl PendingRelease {
    fn new(release: Box<dyn Release>) -> Self {
        Self {
            release,
            bytes: None,
        }
    }
    fn is_downloaded(&self) -> bool {
        self.bytes.is_some()
    }
}
type Pending = Option<PendingRelease>;

pub struct Configuration {
    pub availability: Availability,
    pub backend: Option<Box<dyn Backend>>,
    pub settings: Settings,
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
        configuration: Configuration,
        changed: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        let Configuration {
            availability,
            backend,
            settings,
        } = configuration;
        Self {
            snapshot: Mutex::new(Snapshot::new(version, availability)),
            settings: Mutex::new(settings),
            intent: Mutex::new(Intent::Quit),
            pending: AsyncMutex::new(None),
            backend,
            changed: Box::new(changed),
            wake: Notify::new(),
        }
    }
    pub fn get(&self) -> Snapshot {
        lock_recovering(&self.snapshot).clone()
    }
    fn change(&self, update: impl FnOnce(&mut Snapshot)) {
        update(&mut lock_recovering(&self.snapshot));
        (self.changed)();
    }
    pub fn preferences(&self, settings: Settings) {
        let mut current = lock_recovering(&self.settings);
        let changed = current.update_check_interval != settings.update_check_interval
            || current.install_update_on_quit != settings.install_update_on_quit;
        *current = settings;
        if changed {
            self.wake.notify_one();
        }
    }
    fn fail(&self, error: Error) -> Error {
        self.change(|state| state.failed(error.message.clone()));
        error
    }
    async fn download(&self, pending: &mut Pending) -> Result<()> {
        let pending = pending
            .as_mut()
            .ok_or_else(|| Error::refused("No update is available"))?;
        if pending.is_downloaded() {
            return Ok(());
        }
        self.change(Snapshot::downloading);
        let bytes = pending
            .release
            .download(Box::new(|chunk, total| {
                self.change(|state| state.received(chunk, total))
            }))
            .await
            .map_err(|error| self.fail(error))?;
        pending.bytes = Some(bytes);
        self.change(Snapshot::downloaded);
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
        if *lock_recovering(&self.intent) != Intent::Quit {
            return Ok(());
        }
        self.change(|state| state.enter(Phase::Checking));
        let release = backend.check().await.map_err(|error| self.fail(error))?;
        let available = release.as_ref().map(|item| item.summary());
        let unchanged = available
            .as_ref()
            .zip(pending.as_ref())
            .is_some_and(|(next, previous)| *next == previous.release.summary());
        if !unchanged {
            *pending = release.map(PendingRelease::new);
        }
        let ready = pending.as_ref().is_some_and(PendingRelease::is_downloaded);
        self.change(|state| state.checked(available, ready));
        if pending.is_some() && lock_recovering(&self.settings).install_update_on_quit {
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
        if *lock_recovering(&self.intent) != Intent::Quit {
            return Err(Error::refused("The application is already closing"));
        }
        self.download(&mut pending).await?;
        *lock_recovering(&self.intent) = Intent::Restart;
        self.change(|state| state.enter(Phase::Saving));
        Ok(())
    }
    pub fn skip_install(&self) -> Result<()> {
        if !self.get().can_quit_without_updating {
            return Err(Error::refused("No failed installation to skip"));
        }
        *lock_recovering(&self.intent) = Intent::Skip;
        Ok(())
    }
    pub fn cancel_close(&self) {
        *lock_recovering(&self.intent) = Intent::Quit;
        self.change(Snapshot::close_cancelled);
    }
    pub fn finish_close(&self) -> Result<bool> {
        let intent = *lock_recovering(&self.intent);
        let restart = intent == Intent::Restart;
        let automatic = lock_recovering(&self.settings).install_update_on_quit;
        if intent == Intent::Skip || (!restart && !automatic) {
            return Ok(false);
        }
        let Ok(pending) = self.pending.try_lock() else {
            return Ok(false);
        };
        let Some(PendingRelease {
            release,
            bytes: Some(bytes),
        }) = &*pending
        else {
            return Ok(false);
        };
        self.change(Snapshot::installing);
        if let Err(error) = release.install(bytes, restart) {
            *lock_recovering(&self.intent) = Intent::Quit;
            self.change(Snapshot::install_failed);
            return Err(self.fail(error));
        }
        Ok(restart)
    }
    pub async fn run(self: Arc<Self>) {
        if self.get().availability != Availability::Enabled {
            return;
        }
        loop {
            if interval(&lock_recovering(&self.settings).update_check_interval).is_some() {
                if let Err(error) = self.check().await {
                    tracing::warn!(%error, "Automatic update check failed");
                }
            } else if lock_recovering(&self.settings).install_update_on_quit {
                if let Ok(mut pending) = self.pending.try_lock() {
                    if pending
                        .as_ref()
                        .is_some_and(|pending| !pending.is_downloaded())
                        && *lock_recovering(&self.intent) == Intent::Quit
                    {
                        if let Err(error) = self.download(&mut pending).await {
                            tracing::warn!(%error, "Automatic update download failed");
                        }
                    }
                }
            }
            let delay = interval(&lock_recovering(&self.settings).update_check_interval);
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
    UpdateInterval::parse(value)
        .ok()
        .and_then(UpdateInterval::duration)
}

fn service<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Arc<Service> {
    use tauri::Manager;
    app.state::<Arc<Service>>().inner().clone()
}
pub fn snapshot<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Snapshot {
    service(app).get()
}
pub async fn check_now<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Snapshot> {
    let service = service(app);
    service.check().await?;
    Ok(service.get())
}
pub async fn install_on_close<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Snapshot> {
    let service = service(app);
    service.prepare_install().await?;
    crate::lifecycle::request_close(app);
    Ok(service.get())
}
pub fn quit_without_installing<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Snapshot> {
    let service = service(app);
    service.skip_install()?;
    crate::lifecycle::request_close(app);
    Ok(service.get())
}

pub fn setup<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<()> {
    use tauri::{Emitter, Manager};
    #[cfg(not(feature = "test-utils"))]
    let configuration = native::configure(app)?;
    #[cfg(feature = "test-utils")]
    let configuration = Configuration {
        availability: Availability::Development,
        backend: None,
        settings: Settings::default(),
    };
    let handle = app.clone();
    let service = Arc::new(Service::new(
        app.package_info().version.to_string(),
        configuration,
        move || {
            let _ = handle.emit("update://changed", ());
        },
    ));
    app.manage(service.clone());
    tauri::async_runtime::spawn(service.run());
    Ok(())
}
