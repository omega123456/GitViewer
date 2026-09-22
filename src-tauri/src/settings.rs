use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DEFAULT_PROMPT: &str = "Write a commit message for this diff. One short imperative subject line under 60 characters. Add a body only when needed.";

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
    pub smart_commit: String,
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
            smart_commit: "ask".into(),
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
        || !["system", "light", "dark"].contains(&settings.theme.as_str())
        || !["compact", "comfortable"].contains(&settings.density.as_str())
        || !["split", "unified"].contains(&settings.diff_mode.as_str())
        || !["ask", "always", "never"].contains(&settings.smart_commit.as_str())
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
    let _guard = WRITER.lock().unwrap_or_else(|error| error.into_inner());
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
