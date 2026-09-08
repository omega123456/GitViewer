use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub density: String,
    pub diff_mode: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            density: "comfortable".into(),
            diff_mode: "split".into(),
        }
    }
}
pub fn read(path: &Path) -> Settings {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}
pub fn write(path: &Path, settings: Settings) -> Result<Settings> {
    if !["system", "light", "dark"].contains(&settings.theme.as_str())
        || !["compact", "comfortable"].contains(&settings.density.as_str())
        || !["split", "unified"].contains(&settings.diff_mode.as_str())
    {
        return Err(Error::refused("Invalid settings"));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(&settings)?)?;
    Ok(settings)
}
