use crate::{
    app::main_window,
    error::{Error, Result},
    lock::lock_recovering,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

pub const ZOOM_LEVELS: [u32; 6] = [80, 90, 100, 110, 125, 150];
const DEFAULT_ZOOM: u32 = 100;
const FULL_ZOOM_PERCENT: f64 = 100.0;
const DEFAULT_MAX_FILE_TABS: u32 = 8;
const MIN_FILE_TABS: u32 = 3;
const MAX_FILE_TABS: u32 = 20;
#[cfg(not(feature = "test-utils"))]
const SETTINGS_FILE: &str = "settings.json";

pub const DEFAULT_PROMPT: &str = "Write a concise commit message for this diff (under 220 characters total).\n\
- Subject line: Imperative mood, under 72 characters, summarizing the core functional change.\n\
- Body (when needed): 1–2 short sentences explaining *why* the change was made or how behavior changed.\n\
- Rules: Describe functional impact and intent, not code mechanics. Do not name specific classes/functions or mention routine test updates.";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Ai {
    pub base_url: String,
    pub model: String,
    pub prompt: String,
}
impl Default for Ai {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            model: String::new(),
            prompt: DEFAULT_PROMPT.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    pub density: String,
    pub diff_mode: String,
    pub update_check_interval: String,
    pub install_update_on_quit: bool,
    pub search_ignored_files: bool,
    pub pull_on_checkout: bool,
    pub auto_fetch_interval: String,
    pub smart_commit: String,
    pub zoom: u32,
    pub max_file_tabs: u32,
    pub ai: Ai,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            density: "comfortable".into(),
            diff_mode: "split".into(),
            update_check_interval: "1d".into(),
            install_update_on_quit: true,
            search_ignored_files: false,
            pull_on_checkout: false,
            auto_fetch_interval: "off".into(),
            smart_commit: "ask".into(),
            zoom: DEFAULT_ZOOM,
            max_file_tabs: DEFAULT_MAX_FILE_TABS,
            ai: Ai::default(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    #[serde(flatten)]
    pub settings: Settings,
    pub key_stored: bool,
}
pub fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    #[cfg(feature = "test-utils")]
    {
        let _ = app;
        Err(Error::refused("Global settings are unavailable in tests"))
    }
    #[cfg(not(feature = "test-utils"))]
    {
        use tauri::Manager;
        Ok(app.path().app_config_dir()?.join(SETTINGS_FILE))
    }
}
pub fn apply_window_settings<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<()> {
    apply_zoom(app, settings.zoom)?;
    apply_backdrop(app, &settings.theme)
}
pub fn apply_zoom<R: Runtime>(app: &AppHandle<R>, zoom: u32) -> Result<()> {
    if let Some(window) = main_window(app) {
        window.set_zoom(f64::from(zoom) / FULL_ZOOM_PERCENT)?;
    }
    Ok(())
}
pub fn apply_backdrop<R: Runtime>(app: &AppHandle<R>, theme: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use tauri::window::{Effect, EffectsBuilder};
        const FIRST_WINDOWS_11_BUILD: u64 = 22000;
        let tabbed = matches!(
            tauri_plugin_os::version(),
            tauri_plugin_os::Version::Semantic(_, _, build) if build >= FIRST_WINDOWS_11_BUILD
        );
        if let (true, Some(window)) = (tabbed, main_window(app)) {
            let effect = match theme {
                "dark" => Effect::TabbedDark,
                "light" => Effect::TabbedLight,
                _ => Effect::Tabbed,
            };
            window.set_effects(EffectsBuilder::new().effect(effect).build())?;
        }
    }
    #[cfg(not(windows))]
    let _ = (app, theme);
    Ok(())
}
pub fn endpoint_supported(base_url: &str) -> bool {
    reqwest::Url::parse(base_url).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
}
pub fn read(path: &Path) -> Settings {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}
pub fn write(path: &Path, settings: Settings) -> Result<Settings> {
    if !["1h", "5h", "1d", "7d", "off"].contains(&settings.update_check_interval.as_str())
        || !["30s", "1m", "5m", "10m", "15m", "30m", "off"]
            .contains(&settings.auto_fetch_interval.as_str())
        || !["system", "light", "dark"].contains(&settings.theme.as_str())
        || !["compact", "comfortable"].contains(&settings.density.as_str())
        || !["split", "unified"].contains(&settings.diff_mode.as_str())
        || !["ask", "always", "never"].contains(&settings.smart_commit.as_str())
        || !ZOOM_LEVELS.contains(&settings.zoom)
        || !(MIN_FILE_TABS..=MAX_FILE_TABS).contains(&settings.max_file_tabs)
    {
        return Err(Error::refused("Invalid settings"));
    }
    if !settings.ai.base_url.is_empty() && !endpoint_supported(&settings.ai.base_url) {
        return Err(Error::refused("Invalid endpoint"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    write_json(path, &settings)?;
    Ok(settings)
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    use std::io::Write;
    static WRITER: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = lock_recovering(&WRITER);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&temporary)?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&temporary, path)?;
    Ok(())
}
