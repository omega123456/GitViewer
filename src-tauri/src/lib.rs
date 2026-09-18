use tauri::Manager;

pub mod actions;
pub mod ai;
pub mod blob;
pub mod branch;
pub mod diff;
pub mod error;
pub mod git;
pub mod graph;
pub mod history;
pub mod ipc;
pub mod lifecycle;
pub mod logging;
pub mod repo;
pub mod session;
pub mod settings;
pub mod stash;
pub mod status;
pub mod tree;
pub mod updater;
pub mod watch;

pub fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(feature = "test-utils")]
    let builder = builder.manage(session::Store::default());
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
                    Ok((bytes, mime)) => tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Cache-Control", "no-store")
                        .body(bytes),
                    Err(error) => tauri::http::Response::builder()
                        .status(400)
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
