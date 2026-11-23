#![deny(
    clippy::min_ident_chars,
    clippy::as_conversions,
    clippy::too_many_arguments,
    clippy::type_complexity
)]

use tauri::Manager;

#[deny(clippy::cognitive_complexity)]
pub mod actions;
#[deny(clippy::cognitive_complexity)]
pub mod ai;
#[deny(clippy::cognitive_complexity)]
pub mod app;
#[deny(clippy::cognitive_complexity)]
pub mod blob;
#[deny(clippy::cognitive_complexity)]
pub mod branch;
pub mod diff;
#[deny(clippy::cognitive_complexity)]
pub mod edit;
#[deny(clippy::cognitive_complexity)]
pub mod error;
#[deny(clippy::cognitive_complexity)]
pub mod fs;
#[deny(clippy::cognitive_complexity)]
pub mod git;
#[deny(clippy::cognitive_complexity)]
pub mod graph;
#[deny(clippy::cognitive_complexity)]
pub mod history;
#[deny(clippy::cognitive_complexity)]
pub mod ipc;
#[deny(clippy::cognitive_complexity)]
pub mod lifecycle;
#[deny(clippy::cognitive_complexity)]
pub mod lines;
#[deny(clippy::cognitive_complexity)]
pub mod lock;
#[deny(clippy::cognitive_complexity)]
pub mod logging;
#[deny(clippy::cognitive_complexity)]
pub mod media;
#[deny(clippy::cognitive_complexity)]
pub mod repo;
#[deny(clippy::cognitive_complexity)]
pub mod session;
#[deny(clippy::cognitive_complexity)]
pub mod settings;
#[deny(clippy::cognitive_complexity)]
pub mod stash;
#[deny(clippy::cognitive_complexity)]
pub mod status;
#[deny(clippy::cognitive_complexity)]
pub mod tree;
pub mod updater;
#[deny(clippy::cognitive_complexity)]
pub mod variant;
#[deny(clippy::cognitive_complexity)]
pub mod watch;
#[deny(clippy::cognitive_complexity)]
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
            tauri::async_runtime::spawn(async move {
                let response = blob::serve(&app, request.uri().to_string()).await;
                let response = match response {
                    Ok(blob) => tauri::http::Response::builder()
                        .header("Content-Type", blob.mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "no-store")
                        .body(blob.bytes),
                    Err(error) => tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::BAD_REQUEST)
                        .body(error.message.into_bytes()),
                };
                if let Ok(response) = response {
                    responder.respond(response);
                }
            });
        })
}

pub fn run() {
    configure(tauri::Builder::default())
        .setup(lifecycle::setup)
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            ) {
                lifecycle::capture(window);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !lifecycle::request_close(window.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("GitViewer failed to start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if !lifecycle::request_close(app) {
                    api.prevent_exit();
                }
            }
            if matches!(event, tauri::RunEvent::Exit) {
                lifecycle::flush(app);
                tracing::info!("GitViewer closing");
                if let Some(guard) = app.try_state::<logging::Guard>() {
                    guard.flush();
                }
            }
        });
}
