use super::{Availability, Backend, Progress, Release, Summary, Task};
use crate::{
    error::{Error, Result},
    settings::{self, Settings},
};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

struct Native(tauri_plugin_updater::Updater);
struct Package(tauri_plugin_updater::Update);

impl Backend for Native {
    fn check(&self) -> Task<'_, Option<Box<dyn Release>>> {
        Box::pin(async move {
            self.0
                .check()
                .await
                .map(|update| update.map(|update| Box::new(Package(update)) as Box<dyn Release>))
                .map_err(failure)
        })
    }
}
impl Release for Package {
    fn summary(&self) -> Summary {
        Summary {
            version: self.0.version.clone(),
            notes: self.0.body.clone(),
            date: self
                .0
                .date
                .and_then(|date| {
                    chrono::DateTime::from_timestamp(date.unix_timestamp(), date.nanosecond())
                })
                .map(|date| date.to_rfc3339()),
        }
    }
    fn download<'a>(&'a self, progress: Progress<'a>) -> Task<'a, Vec<u8>> {
        Box::pin(async move { self.0.download(progress, || {}).await.map_err(failure) })
    }
    fn install(&self, bytes: &[u8], restart: bool) -> Result<()> {
        self.0
            .clone()
            .restart_after_install(restart)
            .install(bytes)
            .map_err(failure)
    }
}
fn failure(error: tauri_plugin_updater::Error) -> Error {
    Error::new("update", error.to_string())
}

type Configuration = (Availability, Option<Box<dyn Backend>>, Settings);
pub fn configure<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Configuration> {
    let settings = settings::read(&app.path().app_config_dir()?.join("settings.json"));
    if cfg!(debug_assertions) {
        return Ok((Availability::Development, None, settings));
    }
    let config = &app.config().plugins.0;
    let configured = config.get("updater").is_some_and(|value| {
        value["pubkey"].as_str().is_some_and(|key| !key.is_empty())
            && value["endpoints"]
                .as_array()
                .is_some_and(|endpoints| !endpoints.is_empty())
    });
    if !configured {
        return Ok((Availability::Unconfigured, None, settings));
    }
    app.plugin(tauri_plugin_updater::Builder::new().build())?;
    let updater = app
        .updater_builder()
        .timeout(chrono::Duration::seconds(30).to_std().unwrap())
        .build()
        .map_err(failure)?;
    Ok((
        Availability::Enabled,
        Some(Box::new(Native(updater))),
        settings,
    ))
}
