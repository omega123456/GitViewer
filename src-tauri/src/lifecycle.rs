use crate::{
    app::main_window,
    session::{Geometry, Session, Store},
};
use tauri::{Emitter, Manager, Runtime};

const CLOSE_TIMEOUT_SECONDS: i64 = 2;
const AUTOSAVE_MINUTES: i64 = 5;

pub fn capture<R: Runtime>(window: &tauri::Window<R>) {
    let Some(store) = window.try_state::<Store>() else {
        return;
    };
    let Ok(maximized) = window.is_maximized() else {
        return;
    };
    if window.is_minimized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    if maximized {
        if let Some(mut geometry) = store.get().window {
            geometry.maximized = true;
            store.geometry(geometry);
        }
    } else if let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
        store.geometry(Geometry {
            left: position.x,
            top: position.y,
            width: size.width,
            height: size.height,
            maximized,
        });
    }
}

pub fn flush<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = main_window(app) {
        capture(&window.as_ref().window());
    }
    if let Some(store) = app.try_state::<Store>() {
        if let Err(error) = store.save() {
            tracing::error!(%error, "Unable to save session");
        }
    }
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
        if let Err(error) = app.emit(
            "session://unsaved-edits",
            serde_json::json!({"paths":unsaved}),
        ) {
            tracing::warn!(%error, "Unable to report unsaved edits");
        }
        return false;
    }
    if store.begin_close() {
        flush(app);
        if let Err(error) = app.emit("session://save-requested", ()) {
            tracing::warn!(%error, "Unable to request final session snapshot");
        }
        let app = app.clone();
        tauri::async_runtime::spawn(close_timeout(app));
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
    if let Err(error) = store.save() {
        cancel_close(app);
        return Err(error);
    }
    if let Some(guard) = app.try_state::<crate::logging::Guard>() {
        guard.flush();
    }
    let restart = match app
        .try_state::<std::sync::Arc<crate::updater::Service>>()
        .map(|service| service.finish_close())
        .transpose()
    {
        Ok(restart) => restart.unwrap_or(false),
        Err(error) => {
            cancel_close(app);
            return Err(error);
        }
    };
    if store.allow_close() {
        if restart {
            restart_app(app);
        } else {
            exit(app);
        }
    }
    Ok(())
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

pub fn setup<R: Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(feature = "test-utils")]
    {
        let _ = app;
        Ok(())
    }
    #[cfg(not(feature = "test-utils"))]
    {
        const MIN_WINDOW_WIDTH: u32 = 800;
        const MIN_WINDOW_HEIGHT: u32 = 540;
        const TITLE_BAR_HEIGHT: i64 = 40;
        let guard = crate::logging::init(&app.path().app_log_dir()?)?;
        app.manage(guard);
        app.manage(Store::load(
            app.path().app_config_dir()?.join("session.json"),
        ));
        let settings = crate::settings::read(&crate::settings::settings_path(app.handle())?);
        crate::settings::apply_window_settings(app.handle(), &settings)?;
        if let Some(window) = main_window(app.handle()) {
            if let Some(geometry) = app.state::<Store>().get().window {
                window.set_size(tauri::PhysicalSize::new(
                    geometry.width.max(MIN_WINDOW_WIDTH),
                    geometry.height.max(MIN_WINDOW_HEIGHT),
                ))?;
                let monitors = window.available_monitors()?;
                if monitors.iter().any(|monitor| {
                    let origin = monitor.position();
                    let size = monitor.size();
                    i64::from(geometry.left) < i64::from(origin.x) + i64::from(size.width)
                        && i64::from(geometry.left) + i64::from(geometry.width)
                            > i64::from(origin.x)
                        && i64::from(geometry.top) >= i64::from(origin.y)
                        && i64::from(geometry.top) + TITLE_BAR_HEIGHT
                            < i64::from(origin.y) + i64::from(size.height)
                }) {
                    window
                        .set_position(tauri::PhysicalPosition::new(geometry.left, geometry.top))?;
                } else {
                    window.center()?;
                }
                if geometry.maximized {
                    window.maximize()?;
                }
            }
            window.show()?;
        }
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
