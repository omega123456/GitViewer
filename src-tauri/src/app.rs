use crate::error::{Error, Result};
use serde_json::json;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

const MAIN_WINDOW: &str = "main";
const STATUS_CHANGED: &str = "repo://status-changed";
const HEAD_CHANGED: &str = "repo://head-changed";
const FILES_CHANGED: &str = "repo://files-changed";
const CLOSED: &str = "repo://closed";

pub fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW)
}
fn emit_repo_event<R: Runtime>(app: &AppHandle<R>, event: &str, repo: &str) -> Result<()> {
    app.emit(event, json!({"repo":repo})).map_err(Error::from)
}
pub fn emit_status_changed<R: Runtime>(app: &AppHandle<R>, repo: &str) -> Result<()> {
    emit_repo_event(app, STATUS_CHANGED, repo)
}
pub fn emit_head_changed<R: Runtime>(app: &AppHandle<R>, repo: &str) -> Result<()> {
    emit_repo_event(app, HEAD_CHANGED, repo)
}
pub fn emit_files_changed<R: Runtime>(app: &AppHandle<R>, repo: &str) -> Result<()> {
    emit_repo_event(app, FILES_CHANGED, repo)
}
pub fn emit_closed<R: Runtime>(app: &AppHandle<R>, repo: &str) -> Result<()> {
    emit_repo_event(app, CLOSED, repo)
}
#[cfg(feature = "test-utils")]
pub fn show_edit_menu<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let _ = app;
    Err(Error::refused("Native menus are unavailable in tests"))
}
#[cfg(not(feature = "test-utils"))]
pub fn show_edit_menu<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    use tauri::menu::{Menu, PredefinedMenuItem};
    let window = main_window(app).ok_or_else(|| Error::refused("Main window is unavailable"))?;
    let menu = Menu::with_items(
        app,
        &[
            &PredefinedMenuItem::cut(app, None).map_err(Error::from)?,
            &PredefinedMenuItem::copy(app, None).map_err(Error::from)?,
            &PredefinedMenuItem::paste(app, None).map_err(Error::from)?,
        ],
    )
    .map_err(Error::from)?;
    window.popup_menu(&menu).map_err(Error::from)
}
#[cfg(feature = "test-utils")]
pub fn write_clipboard<R: Runtime>(app: &AppHandle<R>, text: &str) -> Result<()> {
    let _ = (app, text);
    Err(Error::refused("System clipboard is unavailable in tests"))
}
#[cfg(not(feature = "test-utils"))]
pub fn write_clipboard<R: Runtime>(app: &AppHandle<R>, text: &str) -> Result<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|error| Error::unexpected(format!("Clipboard write failed: {error}")))
}
#[cfg(feature = "test-utils")]
pub fn open_in_system<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<()> {
    let _ = (app, path);
    Err(Error::refused("System opener is unavailable in tests"))
}
#[cfg(not(feature = "test-utils"))]
pub fn open_in_system<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(Error::from)
}
