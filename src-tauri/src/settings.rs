use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
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
