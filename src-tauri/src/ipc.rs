use crate::{
    actions::{self, FilesAction},
    ai,
    app::{
        emit_head_changed, emit_status_changed, open_in_system, show_edit_menu, write_clipboard,
    },
    branch,
    diff::{self, DiffSource},
    edit,
    error::{Error, Result},
    git, history, lifecycle, lines, logging,
    repo::{self, Registry, Repository},
    session, settings, stash,
    status::Status,
    tree, updater, worktree,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{value::RawValue, Value};
use tauri::{AppHandle, Manager, Runtime};

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
fn number(args: &Value, key: &str) -> u64 {
    args.get(key).and_then(Value::as_u64).unwrap_or_default()
}
fn index(args: &Value, key: &str) -> usize {
    usize::try_from(number(args, key)).unwrap_or(usize::MAX)
}
fn context_lines(args: &Value) -> u32 {
    args.get("context")
        .and_then(Value::as_u64)
        .map_or(diff::DIFF_CONTEXT_LINES, |context| {
            u32::try_from(context).unwrap_or(u32::MAX)
        })
}
fn decoded<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T> {
    Ok(serde_json::from_value(
        args.get(key).cloned().unwrap_or_default(),
    )?)
}
fn whole<T: DeserializeOwned>(args: &Value) -> Result<T> {
    Ok(serde_json::from_value(args.clone())?)
}
fn source(args: &Value) -> Result<DiffSource> {
    DiffSource::parse(string(args, "source")?)
}
fn optional_source(args: &Value) -> Option<DiffSource> {
    DiffSource::parse(optional(args, "source")).ok()
}
fn raw<T: Serialize + ?Sized>(value: &T) -> Result<Box<RawValue>> {
    Ok(serde_json::value::to_raw_value(value)?)
}

#[tauri::command]
pub async fn execute<R: Runtime>(
    app: AppHandle<R>,
    command: String,
    args: Value,
) -> Result<Box<RawValue>> {
    let result = dispatch(app, command.clone(), args).await;
    if let Err(error) = &result {
        tracing::warn!(command, category = error.category, "IPC command failed");
    }
    result
}
pub async fn dispatch<R: Runtime>(
    app: AppHandle<R>,
    command: String,
    args: Value,
) -> Result<Box<RawValue>> {
    if let Some(value) = application(&app, &command, &args).await? {
        return Ok(value);
    }
    in_repository(&app, &command, &args).await
}

async fn application<R: Runtime>(
    app: &AppHandle<R>,
    command: &str,
    args: &Value,
) -> Result<Option<Box<RawValue>>> {
    let sessions = || app.state::<session::Store>();
    let value = match command {
        "frontend_log" => raw(&logging::frontend_error(string(args, "message")?))?,
        "edit_menu" => raw(&show_edit_menu(app)?)?,
        "clipboard_write" => raw(&write_clipboard(app, string(args, "text")?)?)?,
        "session_get" => raw(&sessions().get())?,
        "unsaved_set" => raw(&sessions().unsaved(decoded(args, "paths")?))?,
        "quit" => raw(&lifecycle::quit(app))?,
        "session_set" => raw(&lifecycle::update_session(app, whole(args)?))?,
        "session_close" => raw(&lifecycle::close_with_session(app, whole(args)?)?)?,
        "update_get" => raw(&updater::snapshot(app))?,
        "update_check" => raw(&updater::check_now(app).await?)?,
        "update_install" => raw(&updater::install_on_close(app).await?)?,
        "update_quit" => raw(&updater::quit_without_installing(app)?)?,
        "env" => raw(&git::detect::environment().await)?,
        "settings_get" => raw(&settings::response(app)?)?,
        "settings_set" => raw(&settings::save(app, whole(args)?)?)?,
        "ai_models" => raw(&ai::configured_models(&settings::current(app)?).await?)?,
        "ai_key_set" => raw(&ai::set_key(string(args, "key")?)?)?,
        "ai_generate" => raw(&ai::generate(
            &settings::current(app)?,
            &app.state::<Registry>(),
            string(args, "repo")?,
        )
        .await?)?,
        "repo_open" => raw(&repo::open_watched(app, string(args, "path")?).await?)?,
        "refresh" => raw(&repo::refresh_announced(app, string(args, "repo")?).await?)?,
        "repo_close" => raw(&repo::close_announced(app, string(args, "repo")?).await?)?,
        _ => return Ok(None),
    };
    Ok(Some(value))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mutation {
    ReadOnly,
    Writes,
    RewritesRefs,
}
fn mutation_of(command: &str) -> Mutation {
    match command {
        "file_write" | "files_action" | "hunk_action" | "commit" | "branch_switch"
        | "branch_merge" | "merge_abort" | "smart_checkout" | "worktree_prune" | "worktree_add"
        | "worktree_remove" => Mutation::Writes,
        "branch_create" | "branch_delete" | "branch_gone" | "branch_prune" | "sync"
        | "stash_save" | "stash_apply" | "stash_drop" | "stash_restore" => Mutation::RewritesRefs,
        _ => Mutation::ReadOnly,
    }
}
#[derive(PartialEq, Eq)]
struct HeadIdentity {
    oid: String,
    branch: String,
}
impl HeadIdentity {
    fn of(status: &Status) -> Self {
        Self {
            oid: status.oid.clone(),
            branch: status.branch.clone(),
        }
    }
}
struct Call<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    repo: &'a Repository,
    id: &'a str,
    command: &'a str,
    args: &'a Value,
}

async fn in_repository<R: Runtime>(
    app: &AppHandle<R>,
    command: &str,
    args: &Value,
) -> Result<Box<RawValue>> {
    let id = string(args, "repo")?;
    let repo = app.state::<Registry>().get(id).await?;
    let call = Call {
        app,
        repo: &repo,
        id,
        command,
        args,
    };
    let mutation = mutation_of(command);
    if mutation == Mutation::ReadOnly {
        return repository_command(&call).await;
    }
    let _write = repo.writes.lock().await;
    let snapshot = repo.snapshot().await?;
    let previous = HeadIdentity::of(&snapshot);
    let outcome = repository_command(&call).await;
    finish_mutation(&call, mutation, previous, outcome).await
}

async fn finish_mutation<R: Runtime>(
    call: &Call<'_, R>,
    mutation: Mutation,
    previous: HeadIdentity,
    outcome: Result<Box<RawValue>>,
) -> Result<Box<RawValue>> {
    let refreshed = call.repo.refresh().await;
    let head_moved = refreshed
        .as_ref()
        .is_ok_and(|status| previous != HeadIdentity::of(status));
    let head_changed = head_moved || mutation == Mutation::RewritesRefs;
    if head_changed {
        call.repo
            .history_stale
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
    emit_status_changed(call.app, call.id)?;
    if head_changed {
        emit_head_changed(call.app, call.id)?;
    }
    if outcome.is_ok() {
        refreshed?;
    }
    outcome
}

async fn repository_command<R: Runtime>(call: &Call<'_, R>) -> Result<Box<RawValue>> {
    if let Some(value) = working_tree_command(call).await? {
        return Ok(value);
    }
    if let Some(value) = diff_command(call).await? {
        return Ok(value);
    }
    if let Some(value) = history_command(call).await? {
        return Ok(value);
    }
    if let Some(value) = branch_command(call).await? {
        return Ok(value);
    }
    if let Some(value) = worktree_command(call).await? {
        return Ok(value);
    }
    if let Some(value) = stash_command(call).await? {
        return Ok(value);
    }
    Err(Error::refused(format!("Unknown command: {}", call.command)))
}
async fn working_tree_command<R: Runtime>(call: &Call<'_, R>) -> Result<Option<Box<RawValue>>> {
    let Call {
        app,
        repo,
        args,
        command,
        ..
    } = *call;
    let path = optional(args, "path");
    let response = match command {
        "status" => raw(&repo.snapshot().await?),
        "line_stats" => raw(&lines::working(repo).await?),
        "tree" => raw(&tree::list(repo, path).await?),
        "files" => raw(&tree::files(repo, flag(args, "ignored")).await?),
        "file_read" => raw(&edit::read(repo, path)?),
        "file_write" => raw(&edit::write(
            repo,
            path,
            string(args, "content")?,
            args.get("expected").and_then(Value::as_str),
        )?),
        "files_action" => raw(&actions::files(
            repo,
            &decoded::<Vec<String>>(args, "paths")?,
            FilesAction::parse(string(args, "action")?)?,
        )
        .await?),
        "commit" => raw(&actions::commit(repo, string(args, "message")?).await?),
        "system_open" => raw(&open_in_system(app, &repo.path(path)?)?),
        _ => return Ok(None),
    };
    response.map(Some)
}

async fn diff_command<R: Runtime>(call: &Call<'_, R>) -> Result<Option<Box<RawValue>>> {
    let Call {
        repo,
        args,
        command,
        ..
    } = *call;
    let path = optional(args, "path");
    let revision = optional(args, "revision");
    let base = optional(args, "base");
    let response = match command {
        "diff" => raw(&diff::read_patched(
            repo,
            path,
            source(args)?,
            revision,
            base,
            context_lines(args),
            flag(args, "overrideLimit"),
        )
        .await?),
        "file_lines" => {
            raw(&diff::text(repo, path, source(args)?, revision, base, flag(args, "old")).await?)
        }
        "diff_stack" => raw(&diff::stack::read_patched(repo, source(args)?, revision, base).await?),
        "hunk_action" => raw(&diff::apply_hunk(
            repo,
            path,
            source(args)?,
            index(args, "hunk"),
            string(args, "patch")?,
            string(args, "action")?,
        )
        .await?),
        "compare_files" => raw(&diff::compare(
            repo,
            string(args, "base")?,
            string(args, "target")?,
            flag(args, "mergeBase"),
        )
        .await?),
        _ => return Ok(None),
    };
    response.map(Some)
}

async fn history_command<R: Runtime>(call: &Call<'_, R>) -> Result<Option<Box<RawValue>>> {
    let Call {
        repo,
        args,
        command,
        ..
    } = *call;
    let path = optional(args, "path");
    let revision = optional(args, "revision");
    let response = match command {
        "history" => raw(&history::page(repo, optional(args, "cursor"), path).await?),
        "commit_files" => {
            raw(&history::files_with_untracked(repo, revision, optional_source(args)).await?)
        }
        "commit_detail" => raw(&history::detail(repo, revision).await?),
        "blame" => raw(&history::blame(repo, path).await?),
        _ => return Ok(None),
    };
    response.map(Some)
}

async fn branch_command<R: Runtime>(call: &Call<'_, R>) -> Result<Option<Box<RawValue>>> {
    let Call {
        app,
        repo,
        id,
        args,
        command,
        ..
    } = *call;
    let response = match command {
        "branches" => raw(&branch::list(repo).await?),
        "default_branch" => raw(&branch::default_branch(repo).await?),
        "branch_switch" => raw(&branch::switch(repo, string(args, "name")?).await?),
        "branch_create" => raw(&branch::create_and_checkout(
            repo,
            string(args, "name")?,
            string(args, "base")?,
            flag(args, "checkout"),
        )
        .await?),
        "branch_delete" => raw(&branch::delete(repo, string(args, "name")?).await?),
        "branch_gone" => raw(&branch::gone(repo).await?),
        "branch_prune" => raw(&branch::prune(repo, decoded(args, "names")?).await?),
        "merge_preview" => raw(&branch::merge_preview(repo, string(args, "name")?).await?),
        "branch_merge" => raw(&branch::merge(repo, string(args, "name")?).await?),
        "merge_abort" => raw(&branch::abort(repo).await?),
        "sync" => raw(&branch::sync_reporting(app, repo, id, string(args, "action")?).await?),
        _ => return Ok(None),
    };
    response.map(Some)
}

async fn worktree_command<R: Runtime>(call: &Call<'_, R>) -> Result<Option<Box<RawValue>>> {
    let Call {
        app,
        repo,
        args,
        command,
        ..
    } = *call;
    let path = optional(args, "path");
    let base = optional(args, "base");
    let response = match command {
        "worktrees" => raw(&worktree::list(&repo.root).await?),
        "worktree_prune" => raw(&worktree::prune(&repo.root).await?),
        "worktree_target" => {
            raw(&worktree::target(repo, string(args, "mode")?, optional(args, "ref"), path).await?)
        }
        "worktree_summary" => {
            raw(
                &worktree::summary_against(repo, &app.state::<Registry>(), string(args, "target")?)
                    .await?,
            )
        }
        "worktree_add" => raw(&worktree::add_to_project(
            app,
            repo,
            path,
            string(args, "mode")?,
            optional(args, "branch"),
            base,
        )
        .await?),
        "worktree_remove" => raw(&worktree::remove_from_project(
            app,
            repo,
            string(args, "worktree")?,
            number(args, "force"),
        )
        .await?),
        "worktree_apply" => raw(&worktree::apply_between(
            app,
            string(args, "source")?,
            string(args, "target")?,
            flag(args, "smart"),
        )
        .await?),
        "worktree_unapply" => raw(&worktree::unapply_in(
            app,
            string(args, "target")?,
            string(args, "base")?,
            string(args, "tree")?,
        )
        .await?),
        _ => return Ok(None),
    };
    response.map(Some)
}

async fn stash_command<R: Runtime>(call: &Call<'_, R>) -> Result<Option<Box<RawValue>>> {
    let Call {
        repo,
        args,
        command,
        ..
    } = *call;
    let response = match command {
        "stashes" => raw(&stash::list(repo).await?),
        "stash_save" => raw(&stash::save(repo, optional(args, "message")).await?),
        "stash_apply" => raw(&stash::apply(
            repo,
            string(args, "hash")?,
            flag(args, "pop"),
            flag(args, "smart"),
        )
        .await?),
        "stash_drop" => raw(&stash::remove(repo, string(args, "hash")?).await?),
        "stash_restore" => {
            raw(&stash::store(repo, string(args, "hash")?, string(args, "message")?).await?)
        }
        "smart_checkout" => raw(&stash::smart_checkout(repo, string(args, "name")?).await?),
        _ => return Ok(None),
    };
    response.map(Some)
}
