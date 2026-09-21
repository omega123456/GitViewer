use crate::{
    actions, ai, branch, diff,
    error::{Error, Result},
    git, history,
    repo::Registry,
    settings, stash, tree, watch,
};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
#[cfg(not(feature = "test-utils"))]
use tauri_plugin_opener::OpenerExt;

fn string<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| Error::refused(format!("Missing {key}")))
}
fn optional<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn flag(args: &Value, key: &str) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(false)
}
fn settings_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf> {
    #[cfg(feature = "test-utils")]
    {
        let _ = app;
        Err(Error::refused("Global settings are unavailable in tests"))
    }
    #[cfg(not(feature = "test-utils"))]
    {
        Ok(app
            .path()
            .app_config_dir()
            .map_err(Error::from)?
            .join("settings.json"))
    }
}
#[tauri::command]
pub async fn execute<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    command: String,
    args: Value,
) -> Result<Value> {
    let result = dispatch(app, command.clone(), args).await;
    if let Err(error) = &result {
        tracing::warn!(command, category = error.category, "IPC command failed");
    }
    result
}
pub async fn dispatch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    command: String,
    args: Value,
) -> Result<Value> {
    let registry = app.state::<Registry>();
    match command.as_str() {
        "frontend_log" => {
            let message = string(&args, "message")?;
            tracing::error!(target: "frontend", message = %message.chars().take(4096).collect::<String>(), "Frontend error");
            return Ok(Value::Null);
        }
        "session_get" => {
            return Ok(serde_json::to_value(
                app.state::<crate::session::Store>().get(),
            )?)
        }
        "session_set" | "session_close" => {
            let session: crate::session::Session = serde_json::from_value(args)?;
            let store = app.state::<crate::session::Store>();
            store.update(session.tabs, session.active);
            if command == "session_close" {
                crate::lifecycle::complete_close(&app)?;
            }
            return Ok(Value::Null);
        }
        "update_get" | "update_check" | "update_install" | "update_quit" => {
            let service = app.state::<std::sync::Arc<crate::updater::Service>>();
            match command.as_str() {
                "update_check" => service.check().await?,
                "update_install" => {
                    service.prepare_install().await?;
                    crate::lifecycle::request_close(&app);
                }
                "update_quit" => {
                    service.skip_install()?;
                    crate::lifecycle::request_close(&app);
                }
                _ => {}
            }
            return Ok(serde_json::to_value(service.get())?);
        }
        "env" => return Ok(serde_json::to_value(git::detect::environment().await)?),
        "settings_get" => {
            return Ok(serde_json::to_value(settings::Response {
                settings: settings::read(&settings_path(&app)?),
                key_stored: ai::key_stored(),
            })?)
        }
        "ai_models" => {
            let preferences = settings::read(&settings_path(&app)?);
            let endpoint =
                ai::Endpoint::new(&preferences.ai.base_url, &ai::key()?.unwrap_or_default());
            return Ok(serde_json::to_value(ai::models(&endpoint).await?)?);
        }
        "ai_key_set" => {
            ai::set_key(string(&args, "key")?)?;
            return Ok(Value::Null);
        }
        "ai_generate" => {
            let preferences = settings::read(&settings_path(&app)?);
            let endpoint =
                ai::Endpoint::new(&preferences.ai.base_url, &ai::key()?.unwrap_or_default());
            let handle = registry.get(string(&args, "repo")?).await?;
            let material = {
                let repo = handle.lock().await;
                ai::material(&repo.root).await?
            };
            return Ok(serde_json::to_value(
                ai::draft(
                    &endpoint,
                    &preferences.ai.model,
                    &preferences.ai.prompt,
                    material,
                )
                .await?,
            )?);
        }
        "settings_set" => {
            let settings =
                settings::write(&settings_path(&app)?, serde_json::from_value(args.clone())?)?;
            if let Some(service) = app.try_state::<std::sync::Arc<crate::updater::Service>>() {
                service.preferences(settings.clone());
            }
            app.emit("settings://changed", ()).map_err(Error::from)?;
            return Ok(serde_json::to_value(settings)?);
        }
        "repo_open" => {
            let info = registry.open(string(&args, "path")?).await?;
            let handle = registry.get(&info.id).await?;
            let mut repo = handle.lock().await;
            if repo.watchers.is_empty() {
                let app = app.clone();
                let id = info.id.clone();
                watch::start(&mut repo, move |head_changed| {
                    let _ = app.emit("repo://status-changed", json!({"repo":id}));
                    if head_changed {
                        let _ = app.emit("repo://head-changed", json!({"repo":id}));
                    }
                })?;
            }
            app.emit("repo://head-changed", json!({"repo":info.id}))
                .map_err(Error::from)?;
            return Ok(serde_json::to_value(info)?);
        }
        "repo_close" => {
            let id = string(&args, "repo")?;
            registry.repos.lock().await.remove(id);
            app.emit("repo://closed", json!({"repo":id}))
                .map_err(Error::from)?;
            return Ok(Value::Null);
        }
        _ => {}
    }
    let id = string(&args, "repo")?;
    let handle = registry.get(id).await?;
    let mut repo = handle.lock().await;
    repo.snapshot().await?;
    let path = optional(&args, "path");
    let revision = optional(&args, "revision");
    let mutating = matches!(
        command.as_str(),
        "refresh"
            | "files_action"
            | "hunk_action"
            | "commit"
            | "branch_switch"
            | "branch_create"
            | "branch_delete"
            | "smart_checkout"
            | "sync"
            | "stash_save"
            | "stash_apply"
            | "stash_drop"
    );
    let previous_head = (repo.status.oid.clone(), repo.status.branch.clone());
    let outcome: Result<Value> = async {
        let value = match command.as_str() {
            "status" => return Ok(serde_json::to_value(repo.snapshot().await?)?),
            "refresh" => {
                repo.refresh().await?;
                Value::Null
            }
            "tree" => return Ok(serde_json::to_value(tree::list(&mut repo, path).await?)?),
            "files" => {
                return Ok(serde_json::to_value(
                    tree::files(&repo, flag(&args, "ignored")).await?,
                )?);
            }
            "diff" => {
                let source = string(&args, "source")?;
                let result = diff::read(
                    &repo,
                    path,
                    source,
                    revision,
                    args.get("context").and_then(Value::as_u64).unwrap_or(3) as u32,
                    flag(&args, "overrideLimit"),
                )
                .await?;
                let patches: Vec<String> = result
                    .hunks
                    .iter()
                    .map(|h| diff::patch(path, h).unwrap_or_default())
                    .collect();
                let mut value = serde_json::to_value(result)?;
                value["patches"] = json!(patches);
                return Ok(value);
            }
            "files_action" => {
                actions::files(
                    &mut repo,
                    &serde_json::from_value::<Vec<String>>(args["paths"].clone())?,
                    string(&args, "action")?,
                )
                .await?;
                Value::Null
            }
            "hunk_action" => {
                diff::apply_hunk(
                    &mut repo,
                    path,
                    string(&args, "source")?,
                    args["hunk"].as_u64().unwrap_or_default() as usize,
                    args.get("context")
                        .and_then(Value::as_u64)
                        .unwrap_or(3)
                        .min(50000) as u32,
                    string(&args, "patch")?,
                    string(&args, "action")?,
                )
                .await?;
                Value::Null
            }
            "commit" => {
                actions::commit(&mut repo, string(&args, "message")?).await?;
                Value::Null
            }
            "branches" => return Ok(serde_json::to_value(branch::list(&repo).await?)?),
            "branch_switch" => {
                branch::switch(&mut repo, string(&args, "name")?).await?;
                Value::Null
            }
            "branch_create" => {
                branch::create(&mut repo, string(&args, "name")?, string(&args, "base")?).await?;
                if flag(&args, "checkout") {
                    branch::switch(&mut repo, string(&args, "name")?).await?;
                }
                Value::Null
            }
            "branch_delete" => {
                branch::delete(&mut repo, string(&args, "name")?).await?;
                Value::Null
            }
            "smart_checkout" => {
                stash::smart_checkout(&mut repo, string(&args, "name")?).await?;
                Value::Null
            }
            "sync" => {
                let action = string(&args, "action")?;
                let reporter = app.clone();
                let reported = id.to_string();
                let outcome = branch::sync(&mut repo, action, move |line| {
                    let _ = reporter.emit(
                        "sync://progress",
                        json!({"repo":reported,"message":line,"done":false}),
                    );
                })
                .await;
                let message = match &outcome {
                    Ok(()) => format!("{action} complete"),
                    Err(error) => format!("{action} failed: {}", error.message),
                };
                app.emit(
                    "sync://progress",
                    json!({"repo":id,"message":message,"done":true}),
                )
                .map_err(Error::from)?;
                outcome?;
                Value::Null
            }
            "history" => {
                return Ok(serde_json::to_value(
                    history::page(&mut repo, optional(&args, "cursor"), path).await?,
                )?)
            }
            "commit_files" => {
                let mut files = history::files(&repo, revision).await?;
                if optional(&args, "source") == "stash" {
                    files.extend(stash::untracked(&repo, revision).await?);
                    files.sort();
                    files.dedup();
                }
                return Ok(serde_json::to_value(files)?);
            }
            "blame" => return Ok(serde_json::to_value(history::blame(&repo, path).await?)?),
            "stashes" => return Ok(serde_json::to_value(stash::list(&repo).await?)?),
            "stash_save" => json!(stash::save(&mut repo, optional(&args, "message")).await?),
            "stash_apply" => {
                stash::apply(
                    &mut repo,
                    string(&args, "hash")?,
                    flag(&args, "pop"),
                    flag(&args, "smart"),
                )
                .await?;
                Value::Null
            }
            "stash_drop" => {
                stash::drop(&mut repo, string(&args, "hash")?).await?;
                Value::Null
            }
            "system_open" => {
                let path = repo.path(path)?;
                #[cfg(feature = "test-utils")]
                {
                    let _ = path;
                    return Err(Error::refused("System opener is unavailable in tests"));
                }
                #[cfg(not(feature = "test-utils"))]
                {
                    app.opener()
                        .open_path(path.to_string_lossy(), None::<&str>)
                        .map_err(Error::from)?;
                    return Ok(Value::Null);
                }
            }
            _ => return Err(Error::refused(format!("Unknown command: {command}"))),
        };
        Ok(value)
    }
    .await;
    if !mutating {
        return outcome;
    }
    let refreshed = repo.refresh().await;
    let head_changed = previous_head != (repo.status.oid.clone(), repo.status.branch.clone())
        || matches!(command.as_str(), "branch_create" | "branch_delete" | "sync");
    if head_changed {
        repo.histories.clear();
    }
    app.emit("repo://status-changed", json!({"repo":id}))
        .map_err(Error::from)?;
    if head_changed {
        app.emit("repo://head-changed", json!({"repo":id}))
            .map_err(Error::from)?;
    }
    if outcome.is_ok() {
        refreshed?;
    }
    outcome
}
