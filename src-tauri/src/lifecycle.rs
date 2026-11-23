use crate::{
    app::main_window,
    session::{Geometry, Session, Store},
};
use tauri::{Emitter, Manager, Runtime};

const CLOSE_TIMEOUT_SECONDS: i64 = 2;
const AUTOSAVE_MINUTES: i64 = 5;

fn is_transient<R: Runtime>(window: &tauri::Window<R>) -> bool {
    let minimized = window.is_minimized().unwrap_or(false);
    minimized || window.is_fullscreen().unwrap_or(false)
}
fn keep_maximized(store: &Store) {
    let Some(mut geometry) = store.get().window else {
        return;
    };
    geometry.maximized = true;
    store.geometry(geometry);
}
pub fn capture<R: Runtime>(window: &tauri::Window<R>) {
    let Some(store) = window.try_state::<Store>() else {
        return;
    };
    let Ok(maximized) = window.is_maximized() else {
        return;
    };
    if is_transient(window) {
        return;
    }
    if maximized {
        keep_maximized(&store);
        return;
    }
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    store.geometry(Geometry {
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        maximized,
    });
}

pub fn flush<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = main_window(app) {
        capture(&window.as_ref().window());
    }
    let Some(store) = app.try_state::<Store>() else {
        return;
    };
    if let Err(error) = store.save() {
        tracing::error!(%error, "Unable to save session");
    }
}

fn report_unsaved<R: Runtime>(app: &tauri::AppHandle<R>, unsaved: Vec<String>) {
    let reported = app.emit(
        "session://unsaved-edits",
        serde_json::json!({"paths":unsaved}),
    );
    if let Err(error) = reported {
        tracing::warn!(%error, "Unable to report unsaved edits");
    }
}
fn start_close<R: Runtime>(app: &tauri::AppHandle<R>) {
    flush(app);
    if let Err(error) = app.emit("session://save-requested", ()) {
        tracing::warn!(%error, "Unable to request final session snapshot");
    }
    tauri::async_runtime::spawn(close_timeout(app.clone()));
}
pub fn request_close<R: Runtime>(app: &tauri::AppHandle<R>) -> bool {
    let Some(store) = app.try_state::<Store>() else {
        return true;
    };
    if store.close_allowed() {
        return true;
    }
    let unsaved = store.unsaved_paths();
    if !unsaved.is_empty() {
        report_unsaved(app, unsaved);
        return false;
    }
    if store.begin_close() {
        start_close(app);
    }
    false
}

pub async fn close_timeout<R: Runtime>(app: tauri::AppHandle<R>) {
    tokio::time::sleep(
        chrono::Duration::seconds(CLOSE_TIMEOUT_SECONDS)
            .to_std()
            .unwrap(),
    )
    .await;
    if let Err(error) = complete_close(&app) {
        tracing::error!(%error, "Unable to save session before closing");
    }
}

pub async fn autosave<R: Runtime>(app: tauri::AppHandle<R>) {
    let period = chrono::Duration::minutes(AUTOSAVE_MINUTES)
        .to_std()
        .unwrap();
    loop {
        tokio::time::sleep(period).await;
        flush(&app);
    }
}

pub fn complete_close<R: Runtime>(app: &tauri::AppHandle<R>) -> crate::error::Result<()> {
    let store = app.state::<Store>();
    if !store.claim_close() {
        return Ok(());
    }
    store.save().inspect_err(|_| cancel_close(app))?;
    if let Some(guard) = app.try_state::<crate::logging::Guard>() {
        guard.flush();
    }
    let restart = finish_update(app).inspect_err(|_| cancel_close(app))?;
    if store.allow_close() {
        leave(app, restart);
    }
    Ok(())
}
fn finish_update<R: Runtime>(app: &tauri::AppHandle<R>) -> crate::error::Result<bool> {
    let restart = app
        .try_state::<std::sync::Arc<crate::updater::Service>>()
        .map(|service| service.finish_close())
        .transpose()?;
    Ok(restart.unwrap_or(false))
}
fn leave<R: Runtime>(app: &tauri::AppHandle<R>, restart: bool) {
    if restart {
        restart_app(app);
        return;
    }
    exit(app);
}

pub fn quit<R: Runtime>(app: &tauri::AppHandle<R>) {
    app.state::<Store>().unsaved(Vec::new());
    request_close(app);
}

pub fn update_session<R: Runtime>(app: &tauri::AppHandle<R>, session: Session) {
    app.state::<Store>().update(session.tabs, session.active);
}

pub fn close_with_session<R: Runtime>(
    app: &tauri::AppHandle<R>,
    session: Session,
) -> crate::error::Result<()> {
    update_session(app, session);
    complete_close(app)
}

fn cancel_close<R: Runtime>(app: &tauri::AppHandle<R>) {
    app.state::<Store>().cancel_close();
    if let Some(service) = app.try_state::<std::sync::Arc<crate::updater::Service>>() {
        service.cancel_close();
    }
    let _ = app.emit("session://close-cancelled", ());
}

fn restart_app<R: Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(not(feature = "test-utils"))]
    app.restart();
    #[cfg(feature = "test-utils")]
    let _ = app;
}

fn exit<R: Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(not(feature = "test-utils"))]
    app.exit(0);
    #[cfg(feature = "test-utils")]
    let _ = app;
}

#[cfg(not(feature = "test-utils"))]
const MIN_WINDOW_WIDTH: u32 = 800;
#[cfg(not(feature = "test-utils"))]
const MIN_WINDOW_HEIGHT: u32 = 540;
#[cfg(not(feature = "test-utils"))]
const TITLE_BAR_HEIGHT: i64 = 40;

#[cfg(not(feature = "test-utils"))]
fn shows_title_bar(geometry: &Geometry, monitor: &tauri::Monitor) -> bool {
    let origin = monitor.position();
    let size = monitor.size();
    let left = i64::from(geometry.left);
    let top = i64::from(geometry.top);
    let monitor_left = i64::from(origin.x);
    let monitor_top = i64::from(origin.y);
    let monitor_right = monitor_left + i64::from(size.width);
    let monitor_bottom = monitor_top + i64::from(size.height);
    let overlaps_horizontally =
        left < monitor_right && left + i64::from(geometry.width) > monitor_left;
    let title_bar_inside = top >= monitor_top && top + TITLE_BAR_HEIGHT < monitor_bottom;
    overlaps_horizontally && title_bar_inside
}
#[cfg(not(feature = "test-utils"))]
fn position_window<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    geometry: &Geometry,
) -> tauri::Result<()> {
    let monitors = window.available_monitors()?;
    let visible = monitors
        .iter()
        .any(|monitor| shows_title_bar(geometry, monitor));
    if !visible {
        return window.center();
    }
    window.set_position(tauri::PhysicalPosition::new(geometry.left, geometry.top))
}
#[cfg(not(feature = "test-utils"))]
fn restore_geometry<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    geometry: &Geometry,
) -> tauri::Result<()> {
    window.set_size(tauri::PhysicalSize::new(
        geometry.width.max(MIN_WINDOW_WIDTH),
        geometry.height.max(MIN_WINDOW_HEIGHT),
    ))?;
    position_window(window, geometry)?;
    if geometry.maximized {
        window.maximize()?;
    }
    Ok(())
}
#[cfg(not(feature = "test-utils"))]
fn restore_window<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let Some(window) = main_window(app.handle()) else {
        return Ok(());
    };
    if let Some(geometry) = app.state::<Store>().get().window {
        restore_geometry(&window, &geometry)?;
    }
    window.show()
}

pub fn setup<R: Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(feature = "test-utils")]
    {
        let _ = app;
        Ok(())
    }
    #[cfg(not(feature = "test-utils"))]
    {
        let guard = crate::logging::init(&app.path().app_log_dir()?)?;
        app.manage(guard);
        app.manage(Store::load(
            app.path().app_config_dir()?.join("session.json"),
        ));
        let settings = crate::settings::read(&crate::settings::settings_path(app.handle())?);
        crate::settings::apply_window_settings(app.handle(), &settings)?;
        restore_window(app)?;
        tracing::info!(
            version = app.package_info().version.to_string(),
            "GitViewer started"
        );
        crate::updater::setup(app.handle())?;
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(autosave(handle));
        Ok(())
    }
}
