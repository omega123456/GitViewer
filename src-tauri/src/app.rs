use crate::error::{Error, Result};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

const MAIN_WINDOW: &str = "main";
const STATUS_CHANGED: &str = "repo://status-changed";

pub fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW)
}
pub fn emit_status_changed<R: Runtime>(app: &AppHandle<R>, repo: &str) -> Result<()> {
    app.emit(STATUS_CHANGED, json!({"repo":repo}))
        .map_err(Error::from)
}
