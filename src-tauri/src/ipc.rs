use crate::{
    actions, ai, branch, diff, edit,
    error::{Error, Result},
    git, history, lines,
    repo::Registry,
    settings, stash, tree, watch, worktree,
};
use serde::Serialize;
use serde_json::{json, value::RawValue, Value};
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
fn raw<T: Serialize + ?Sized>(value: &T) -> Result<Box<RawValue>> {
    Ok(serde_json::value::to_raw_value(value)?)
}
fn done() -> Result<Box<RawValue>> {
    raw(&())
}
fn patched(diff: &mut diff::Diff) {
    if matches!(diff.source.as_str(), "staged" | "unstaged") {
        diff.patches = diff
            .hunks
            .iter()
            .map(|hunk| diff::patch(&diff.path, hunk).unwrap_or_default())
            .collect();
    }
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
fn project_changed<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    repo: &crate::repo::Repo,
) -> Result<()> {
    app.emit(
        "repo://status-changed",
        json!({"repo":repo.project.to_string_lossy()}),
    )
    .map_err(Error::from)
}
#[tauri::command]
pub async fn execute<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    command: String,
    args: Value,
) -> Result<Box<RawValue>> {
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
) -> Result<Box<RawValue>> {
    let registry = app.state::<Registry>();
    match command.as_str() {
        "frontend_log" => {
            let message = string(&args, "message")?;
            tracing::error!(target: "frontend", message = %message.chars().take(4096).collect::<String>(), "Frontend error");
            return done();
        }
        "edit_menu" => {
            #[cfg(feature = "test-utils")]
            return Err(Error::refused("Native menus are unavailable in tests"));
            #[cfg(not(feature = "test-utils"))]
            {
                use tauri::menu::{Menu, PredefinedMenuItem};
                let window = app
                    .get_webview_window("main")
                    .ok_or_else(|| Error::refused("Main window is unavailable"))?;
                let menu = Menu::with_items(
                    &app,
                    &[
                        &PredefinedMenuItem::cut(&app, None).map_err(Error::from)?,
                        &PredefinedMenuItem::copy(&app, None).map_err(Error::from)?,
                        &PredefinedMenuItem::paste(&app, None).map_err(Error::from)?,
                    ],
                )
                .map_err(Error::from)?;
                window.popup_menu(&menu).map_err(Error::from)?;
                return done();
            }
        }
        "session_get" => return raw(&app.state::<crate::session::Store>().get()),
        "unsaved_set" => {
            let paths: Vec<String> =
                serde_json::from_value(args.get("paths").cloned().unwrap_or_default())?;
            app.state::<crate::session::Store>().unsaved(paths);
            return done();
        }
        "quit" => {
            app.state::<crate::session::Store>().unsaved(Vec::new());
            crate::lifecycle::request_close(&app);
            return done();
        }
        "session_set" | "session_close" => {
            let session: crate::session::Session = serde_json::from_value(args)?;
            let store = app.state::<crate::session::Store>();
            store.update(session.tabs, session.active);
            if command == "session_close" {
                crate::lifecycle::complete_close(&app)?;
            }
            return done();
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
            return raw(&service.get());
        }
        "env" => return raw(&git::detect::environment().await),
        "settings_get" => {
            return raw(&settings::Response {
                settings: settings::read(&settings_path(&app)?),
                key_stored: ai::key_stored(),
            })
        }
        "ai_models" => {
            let preferences = settings::read(&settings_path(&app)?);
            let endpoint =
                ai::Endpoint::new(&preferences.ai.base_url, &ai::key()?.unwrap_or_default());
            return raw(&ai::models(&endpoint).await?);
        }
        "ai_key_set" => {
            ai::set_key(string(&args, "key")?)?;
            return done();
        }
        "ai_generate" => {
            let preferences = settings::read(&settings_path(&app)?);
            let endpoint =
                ai::Endpoint::new(&preferences.ai.base_url, &ai::key()?.unwrap_or_default());
            let material = ai::material(&registry.get(string(&args, "repo")?).await?.root).await?;
            return raw(&ai::draft(
                &endpoint,
                &preferences.ai.model,
                &preferences.ai.prompt,
                material,
            )
            .await?);
        }
        "settings_set" => {
            let settings =
                settings::write(&settings_path(&app)?, serde_json::from_value(args.clone())?)?;
            if let Some(service) = app.try_state::<std::sync::Arc<crate::updater::Service>>() {
                service.preferences(settings.clone());
            }
            settings::apply_zoom(&app, settings.zoom)?;
            app.emit("settings://changed", ()).map_err(Error::from)?;
            return raw(&settings);
        }
        "repo_open" => {
            let info = registry.open(string(&args, "path")?).await?;
            let repo = registry.get(&info.id).await?;
            let watcher = app.clone();
            let id = info.id.clone();
            watch::start(&repo, move |change| {
                if change == watch::Change::Files {
                    let _ = watcher.emit("repo://files-changed", json!({"repo":id}));
                    return;
                }
                let _ = watcher.emit("repo://status-changed", json!({"repo":id}));
                if change == watch::Change::Head {
                    let _ = watcher.emit("repo://head-changed", json!({"repo":id}));
                }
            })?;
            app.emit("repo://head-changed", json!({"repo":info.id}))
                .map_err(Error::from)?;
            return raw(&info);
        }
        "refresh" => {
            let id = string(&args, "repo")?;
            let repo = registry.get(id).await?;
            let _write = repo.writes.lock().await;
            let reread = repo.reread().await;
            app.emit("repo://status-changed", json!({"repo":id}))
                .map_err(Error::from)?;
            if reread.as_ref().is_ok_and(|reread| reread.moved) {
                app.emit("repo://head-changed", json!({"repo":id}))
                    .map_err(Error::from)?;
            }
            reread?;
            return done();
        }
        "repo_close" => {
            let id = string(&args, "repo")?;
            registry.repos.lock().await.remove(id);
            app.emit("repo://closed", json!({"repo":id}))
                .map_err(Error::from)?;
            return done();
        }
        _ => {}
    }
    let id = string(&args, "repo")?;
    let repo = registry.get(id).await?;
    let path = optional(&args, "path");
    let revision = optional(&args, "revision");
    let mutating = matches!(
        command.as_str(),
        "file_write"
            | "files_action"
            | "hunk_action"
            | "commit"
            | "branch_switch"
            | "branch_create"
            | "branch_delete"
            | "branch_gone"
            | "branch_prune"
            | "branch_merge"
            | "merge_abort"
            | "smart_checkout"
            | "sync"
            | "stash_save"
            | "stash_apply"
            | "stash_drop"
            | "stash_restore"
            | "worktree_prune"
            | "worktree_add"
            | "worktree_remove"
    );
    let _write = if mutating {
        Some(repo.writes.lock().await)
    } else {
        None
    };
    let previous_head = if mutating {
        let status = repo.snapshot().await?;
        (status.oid.clone(), status.branch.clone())
    } else {
        Default::default()
    };
    let outcome: Result<Box<RawValue>> = async {
        let value = match command.as_str() {
            "status" => return raw(&repo.snapshot().await?),
            "line_stats" => return raw(&lines::working(&repo).await?),
            "tree" => return raw(&tree::list(&repo, path).await?),
            "files" => {
                return raw(&tree::files(&repo, flag(&args, "ignored")).await?);
            }
            "diff" => {
                let source = string(&args, "source")?;
                let mut result = diff::read(
                    &repo,
                    path,
                    source,
                    revision,
                    optional(&args, "base"),
                    args.get("context").and_then(Value::as_u64).unwrap_or(3) as u32,
                    flag(&args, "overrideLimit"),
                )
                .await?;
                patched(&mut result);
                return raw(&result);
            }
            "file_read" => return raw(&edit::read(&repo, path)?),
            "file_write" => raw(&edit::write(
                &repo,
                path,
                string(&args, "content")?,
                args.get("expected").and_then(Value::as_str),
            )?)?,
            "file_lines" => {
                return raw(&diff::text(
                    &repo,
                    path,
                    string(&args, "source")?,
                    revision,
                    optional(&args, "base"),
                )
                .await?);
            }
            "diff_stack" => {
                let mut stack = diff::stack::read(
                    &repo,
                    string(&args, "source")?,
                    revision,
                    optional(&args, "base"),
                )
                .await?;
                stack.files.values_mut().for_each(patched);
                return raw(&stack);
            }
            "files_action" => {
                actions::files(
                    &repo,
                    &serde_json::from_value::<Vec<String>>(args["paths"].clone())?,
                    string(&args, "action")?,
                )
                .await?;
                done()?
            }
            "hunk_action" => {
                diff::apply_hunk(
                    &repo,
                    path,
                    string(&args, "source")?,
                    args["hunk"].as_u64().unwrap_or_default() as usize,
                    string(&args, "patch")?,
                    string(&args, "action")?,
                )
                .await?;
                done()?
            }
            "commit" => raw(&actions::commit(&repo, string(&args, "message")?).await?)?,
            "branches" => return raw(&branch::list(&repo).await?),
            "worktrees" => return raw(&worktree::list(&repo.root).await?),
            "worktree_prune" => {
                worktree::prune(&repo.root).await?;
                done()?
            }
            "worktree_target" => {
                return raw(&worktree::target(
                    &repo,
                    string(&args, "mode")?,
                    optional(&args, "ref"),
                    path,
                )
                .await?)
            }
            "worktree_summary" => {
                let target = registry.get(string(&args, "target")?).await?;
                return raw(&worktree::summary(&repo, &target.snapshot().await?.oid).await?);
            }
            "worktree_add" => {
                let created = worktree::add(
                    &repo,
                    path,
                    string(&args, "mode")?,
                    optional(&args, "branch"),
                    optional(&args, "base"),
                )
                .await?;
                project_changed(&app, &repo)?;
                raw(&created)?
            }
            "worktree_remove" => {
                worktree::remove(
                    &repo,
                    string(&args, "worktree")?,
                    args["force"].as_u64().unwrap_or_default(),
                )
                .await?;
                project_changed(&app, &repo)?;
                done()?
            }
            "worktree_apply" | "worktree_unapply" => {
                let target_id = string(&args, "target")?;
                let target = registry.get(target_id).await?;
                let result = if command == "worktree_apply" {
                    let source = registry.get(string(&args, "source")?).await?;
                    if std::sync::Arc::ptr_eq(&source, &target) {
                        return Err(Error::refused("Choose a worktree other than main"));
                    }
                    let _target = target.writes.lock().await;
                    let _source = source.writes.lock().await;
                    worktree::apply(&source, &target, flag(&args, "smart"))
                        .await
                        .and_then(|applied| raw(&applied))
                } else {
                    let _target = target.writes.lock().await;
                    worktree::unapply(&target, string(&args, "base")?, string(&args, "tree")?)
                        .await
                        .and_then(|()| done())
                };
                target.refresh().await?;
                app.emit("repo://status-changed", json!({"repo":target_id}))
                    .map_err(Error::from)?;
                return result;
            }
            "default_branch" => return raw(&branch::default_branch(&repo).await?),
            "compare_files" => {
                return raw(&diff::compare(
                    &repo,
                    string(&args, "base")?,
                    string(&args, "target")?,
                    flag(&args, "mergeBase"),
                )
                .await?)
            }
            "branch_switch" => {
                branch::switch(&repo, string(&args, "name")?).await?;
                done()?
            }
            "branch_create" => {
                branch::create(&repo, string(&args, "name")?, string(&args, "base")?).await?;
                if flag(&args, "checkout") {
                    branch::switch(&repo, string(&args, "name")?).await?;
                }
                done()?
            }
            "branch_delete" => {
                branch::delete(&repo, string(&args, "name")?).await?;
                done()?
            }
            "branch_gone" => raw(&branch::gone(&repo).await?)?,
            "branch_prune" => {
                raw(&branch::prune(&repo, serde_json::from_value(args["names"].clone())?).await?)?
            }
            "merge_preview" => {
                return raw(&branch::merge_preview(&repo, string(&args, "name")?).await?)
            }
            "branch_merge" => raw(&branch::merge(&repo, string(&args, "name")?).await?)?,
            "merge_abort" => {
                branch::abort(&repo).await?;
                done()?
            }
            "smart_checkout" => {
                stash::smart_checkout(&repo, string(&args, "name")?).await?;
                done()?
            }
            "sync" => {
                let action = string(&args, "action")?;
                let reporter = app.clone();
                let reported = id.to_string();
                let outcome = branch::sync(&repo, action, move |line| {
                    let _ = reporter.emit(
                        "sync://progress",
                        json!({"repo":reported,"message":line,"done":false}),
                    );
                })
                .await;
                let message = match &outcome {
                    Ok(_) => format!("{action} complete"),
                    Err(error) => format!("{action} failed: {}", error.message),
                };
                app.emit(
                    "sync://progress",
                    json!({"repo":id,"message":message,"done":true}),
                )
                .map_err(Error::from)?;
                raw(&outcome?)?
            }
            "history" => return raw(&history::page(&repo, optional(&args, "cursor"), path).await?),
            "commit_files" => {
                let mut files = history::files(&repo, revision).await?;
                if optional(&args, "source") == "stash" {
                    for path in stash::untracked(&repo, revision).await? {
                        files.statuses.entry(path).or_insert_with(|| "?".into());
                    }
                }
                return raw(&files);
            }
            "blame" => return raw(&history::blame(&repo, path).await?),
            "stashes" => return raw(&stash::list(&repo).await?),
            "stash_save" => raw(&stash::save(&repo, optional(&args, "message")).await?)?,
            "stash_apply" => {
                stash::apply(
                    &repo,
                    string(&args, "hash")?,
                    flag(&args, "pop"),
                    flag(&args, "smart"),
                )
                .await?;
                done()?
            }
            "stash_drop" => {
                stash::drop(&repo, string(&args, "hash")?).await?;
                done()?
            }
            "stash_restore" => {
                stash::store(&repo, string(&args, "hash")?, string(&args, "message")?).await?;
                done()?
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
                    return done();
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
    let head_changed = refreshed
        .as_ref()
        .is_ok_and(|status| previous_head != (status.oid.clone(), status.branch.clone()))
        || matches!(
            command.as_str(),
            "branch_create"
                | "branch_delete"
                | "branch_gone"
                | "branch_prune"
                | "sync"
                | "stash_save"
                | "stash_apply"
                | "stash_drop"
                | "stash_restore"
        );
    if head_changed {
        repo.history_stale
            .store(true, std::sync::atomic::Ordering::SeqCst);
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
