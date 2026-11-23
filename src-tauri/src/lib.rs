#![deny(
    clippy::min_ident_chars,
    clippy::as_conversions,
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::cognitive_complexity,
    clippy::excessive_nesting,
    clippy::too_many_lines
)]

use tauri::Manager;

pub mod actions;
pub mod ai;
pub mod app;
pub mod blob;
pub mod branch;
pub mod diff;
pub mod edit;
pub mod error;
pub mod fs;
pub mod git;
pub mod graph;
pub mod history;
pub mod ipc;
pub mod lifecycle;
pub mod lines;
pub mod lock;
pub mod logging;
pub mod media;
pub mod repo;
pub mod session;
pub mod settings;
pub mod stash;
pub mod status;
pub mod tree;
pub mod updater;
pub mod variant;
pub mod watch;
pub mod worktree;

pub fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(feature = "test-utils")]
    let builder = builder.manage(session::Store::default());
    #[cfg(not(feature = "test-utils"))]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(repo::Registry::default())
        .invoke_handler(tauri::generate_handler![ipc::execute])
        .register_asynchronous_uri_scheme_protocol("gitblob", |context, request, responder| {
            let app = context.app_handle().clone();
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(respond_with_blob(app, uri, responder));
        })
}

async fn respond_with_blob<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    uri: String,
    responder: tauri::UriSchemeResponder,
) {
    let served = blob::serve(&app, uri).await;
    if let Ok(response) = blob_response(served) {
        responder.respond(response);
    }
}

fn blob_response(
    served: error::Result<blob::Blob>,
) -> tauri::http::Result<tauri::http::Response<Vec<u8>>> {
    match served {
        Ok(blob) => tauri::http::Response::builder()
            .header("Content-Type", blob.mime)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-store")
            .body(blob.bytes),
        Err(error) => tauri::http::Response::builder()
            .status(tauri::http::StatusCode::BAD_REQUEST)
            .body(error.message.into_bytes()),
    }
}

fn on_window_event<R: tauri::Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    let geometry_changed = matches!(
        event,
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
    );
    if geometry_changed {
        lifecycle::capture(window);
    }
    let tauri::WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if !lifecycle::request_close(window.app_handle()) {
        api.prevent_close();
    }
}

fn exit_requested<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &tauri::RunEvent) {
    let tauri::RunEvent::ExitRequested { api, .. } = event else {
        return;
    };
    if !lifecycle::request_close(app) {
        api.prevent_exit();
    }
}

fn exiting<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    lifecycle::flush(app);
    tracing::info!("GitViewer closing");
    if let Some(guard) = app.try_state::<logging::Guard>() {
        guard.flush();
    }
}

fn on_run_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::RunEvent) {
    exit_requested(app, &event);
    if matches!(event, tauri::RunEvent::Exit) {
        exiting(app);
    }
}

pub fn run() {
    configure(tauri::Builder::default())
        .setup(lifecycle::setup)
        .on_window_event(on_window_event)
        .build(tauri::generate_context!())
        .expect("GitViewer failed to start")
        .run(on_run_event);
}
