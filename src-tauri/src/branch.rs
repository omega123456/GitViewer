use crate::{
    diff::resolve,
    error::{Error, Result},
    git,
    repo::Repo,
    status::Status,
    variant,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Runtime};

const SYNC_PROGRESS: &str = "sync://progress";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncAction {
    Fetch,
    Pull,
    Push,
}
impl SyncAction {
    pub fn parse(name: &str) -> Result<Self> {
        variant::parse(name, "Unknown synchronization action")
    }
}

#[derive(Debug, Serialize)]
pub struct Branch {
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub default: bool,
    pub upstream: String,
    pub gone: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub worktree: String,
}

#[derive(Debug, Serialize)]
pub struct Pruned {
    pub deleted: Vec<String>,
    pub kept: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct MergePreview {
    pub outcome: String,
    pub changed: usize,
    pub conflicts: Vec<String>,
}
const DELETE_BATCH: usize = 100;
const BRANCH_FORMAT: &str = "--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(worktreepath)%00%(upstream:track)%00%(symref:short)";
pub async fn list(repo: &Repo) -> Result<Vec<Branch>> {
    let text = git::text(
        &repo.root,
        &["for-each-ref", BRANCH_FORMAT, "refs/heads", "refs/remotes"],
    )
    .await?;
    let records: Vec<RefRecord> = text.lines().filter_map(parse_ref_record).collect();
    let remote_defaults: Vec<&str> = records
        .iter()
        .filter(|record| is_remote_head(record.refname))
        .map(|record| record.symref)
        .filter(|target| !target.is_empty())
        .collect();
    Ok(records
        .iter()
        .filter(|record| !is_remote_head(record.refname))
        .map(|record| branch_of(record, &remote_defaults))
        .collect())
}
struct RefRecord<'a> {
    refname: &'a str,
    head: &'a str,
    upstream: &'a str,
    worktree: &'a str,
    track: &'a str,
    symref: &'a str,
}
fn parse_ref_record(line: &str) -> Option<RefRecord<'_>> {
    let mut fields = line.split(git::NUL);
    let record = RefRecord {
        refname: fields.next()?,
        head: fields.next()?,
        upstream: fields.next()?,
        worktree: fields.next()?,
        track: fields.next()?,
        symref: fields.next()?,
    };
    fields.next().is_none().then_some(record)
}
fn worktree_path(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    crate::worktree::canonical(path)
        .to_string_lossy()
        .into_owned()
}
fn branch_of(record: &RefRecord<'_>, remote_defaults: &[&str]) -> Branch {
    let name = record
        .refname
        .trim_start_matches("refs/heads/")
        .trim_start_matches("refs/remotes/");
    let remote = record.refname.starts_with("refs/remotes/");
    Branch {
        name: name.into(),
        remote,
        current: record.head == "*",
        default: is_default(name, remote, remote_defaults),
        upstream: record.upstream.into(),
        gone: record.track == "[gone]",
        worktree: worktree_path(record.worktree),
    }
}
fn is_remote_head(refname: &str) -> bool {
    refname.ends_with("/HEAD")
}
fn is_default(name: &str, remote: bool, remote_defaults: &[&str]) -> bool {
    if remote {
        return remote_defaults.contains(&name);
    }
    remote_defaults
        .iter()
        .filter_map(|target| git::split_remote(target))
        .any(|target| target.branch == name)
}
pub async fn switch(repo: &Repo, name: &str) -> Result<()> {
    repo.writable().await?;
    let branches = list(repo).await?;
    let branch = branches
        .iter()
        .find(|branch| branch.name == name)
        .ok_or_else(|| Error::refused("Choose an existing branch"))?;
    let mut target = name;
    let mut arguments = vec!["checkout"];
    if branch.remote {
        let local = git::split_remote(name)
            .ok_or_else(|| Error::refused("Invalid remote branch"))?
            .branch;
        if let Some(existing) = branches
            .iter()
            .find(|branch| !branch.remote && branch.name == local)
        {
            if existing.upstream != name {
                return Err(Error::refused(format!(
                    "Local branch {local} already exists and tracks a different reference"
                )));
            }
            target = local;
        } else {
            arguments.extend(["--track", "-b", local]);
        }
    }
    arguments.extend([target, "--"]);
    git::run(&repo.root, &arguments, None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
pub async fn create(repo: &Repo, name: &str, base: &str) -> Result<()> {
    repo.writable().await?;
    git::run(&repo.root, &["check-ref-format", "--branch", name], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    let base = resolve(repo, base).await?;
    git::run(&repo.root, &["branch", name, &base], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
pub async fn delete(repo: &Repo, name: &str) -> Result<()> {
    repo.writable().await?;
    let branches = list(repo).await?;
    let branch = branches
        .iter()
        .find(|branch| branch.name == name)
        .ok_or_else(|| Error::refused("Branch no longer exists"))?;
    if branch.current {
        return Err(Error::refused(
            "Switch away from this branch before deleting it",
        ));
    }
    if branch.default {
        return Err(Error::refused("The default branch cannot be deleted"));
    }
    if branch.remote {
        return delete_remote(repo, name).await;
    }
    git::run(&repo.root, &["branch", "-D", "--", name], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
async fn delete_remote(repo: &Repo, name: &str) -> Result<()> {
    let target = git::split_remote(name).ok_or_else(|| Error::refused("Invalid remote branch"))?;
    git::run(
        &repo.root,
        &["push", target.remote, "--delete", target.branch],
        None,
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
async fn local_remotes_only(repo: &Repo) -> Result<()> {
    #[cfg(feature = "test-utils")]
    {
        let remotes = git::text(&repo.root, &["remote", "-v"]).await?;
        if remotes.lines().any(|line| {
            line.split_whitespace()
                .nth(1)
                .is_some_and(|url| url.contains("://") || url.contains('@'))
        }) {
            return Err(Error::refused(
                "Tests may only synchronize local fixture remotes",
            ));
        }
    }
    #[cfg(not(feature = "test-utils"))]
    let _ = repo;
    Ok(())
}
async fn candidates(repo: &Repo) -> Result<Vec<String>> {
    let default = default_branch(repo).await.ok();
    Ok(list(repo)
        .await?
        .into_iter()
        .filter(|branch| {
            !branch.remote
                && (branch.gone || branch.upstream.is_empty())
                && !branch.current
                && branch.worktree.is_empty()
                && default.as_deref() != Some(branch.name.as_str())
        })
        .map(|branch| branch.name)
        .collect())
}
pub async fn gone(repo: &Repo) -> Result<Vec<String>> {
    repo.writable().await?;
    local_remotes_only(repo).await?;
    git::run(&repo.root, &["fetch", "--all", "--prune"], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    candidates(repo).await
}
pub async fn prune(repo: &Repo, names: Vec<String>) -> Result<Pruned> {
    repo.writable().await?;
    let allowed = candidates(repo).await?;
    let targets: Vec<String> = names
        .into_iter()
        .filter(|name| allowed.contains(name))
        .collect();
    for chunk in targets.chunks(DELETE_BATCH) {
        let mut arguments = vec!["branch", "-d", "--"];
        arguments.extend(chunk.iter().map(String::as_str));
        git::run(&repo.root, &arguments, None)
            .await?
            .accept(&git::SUCCESS_OR_DIFFERENT)?;
    }
    let remaining: Vec<String> = list(repo)
        .await?
        .into_iter()
        .map(|branch| branch.name)
        .collect();
    let (kept, deleted) = targets
        .into_iter()
        .partition(|name| remaining.contains(name));
    Ok(Pruned { deleted, kept })
}
async fn tip(repo: &Repo, name: Option<&str>) -> Option<String> {
    resolve(repo, name?).await.ok()
}
async fn distance(repo: &Repo, from: Option<String>, to: Option<String>) -> Result<Option<u32>> {
    let (Some(from), Some(to)) = (from, to) else {
        return Ok(None);
    };
    let count = git::text(
        &repo.root,
        &["rev-list", "--count", &git::range(&from, &to)],
    )
    .await?;
    Ok(count.trim().parse().ok())
}
async fn moved(repo: &Repo, tracked: Option<&str>, before: Option<String>) -> Result<Option<u32>> {
    let after = tip(repo, tracked).await;
    distance(repo, before, after).await
}
fn require_branch(status: &Status) -> Result<()> {
    if status.branch == git::DETACHED_LABEL {
        return Err(Error::refused("Detached HEAD has no upstream branch"));
    }
    Ok(())
}
async fn fetch<F: Fn(&str)>(repo: &Repo, status: &Status, progress: &F) -> Result<Option<u32>> {
    let tracked = status.upstream.as_deref();
    let before = tip(repo, tracked).await;
    git::stream(&repo.root, &["fetch", "--all", "--progress"], progress)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    moved(repo, tracked, before).await
}
async fn publish<F: Fn(&str)>(repo: &Repo, progress: &F) -> Result<()> {
    let remote = push_remote(repo).await?;
    git::stream(
        &repo.root,
        &["push", "--progress", "--set-upstream", &remote, git::HEAD],
        progress,
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
async fn push<F: Fn(&str)>(repo: &Repo, status: &Status, progress: &F) -> Result<Option<u32>> {
    require_branch(status)?;
    let tracked = status.upstream.as_deref();
    let before = tip(repo, tracked).await;
    if tracked.is_none() {
        publish(repo, progress).await?;
        return moved(repo, tracked, before).await;
    }
    git::stream(&repo.root, &["push", "--progress"], progress)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    moved(repo, tracked, before).await
}
fn diverged(status: &Status, upstream_name: &str) -> Error {
    Error::new(
        "diverged",
        format!("{} and {upstream_name} have diverged", status.branch),
    )
}
async fn pull<F: Fn(&str)>(repo: &Repo, status: &Status, progress: &F) -> Result<Option<u32>> {
    require_branch(status)?;
    let tracked = Some(git::HEAD);
    let before = tip(repo, tracked).await;
    git::stream(&repo.root, &["fetch", "--progress"], progress)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    let upstream_name = status
        .upstream
        .as_deref()
        .ok_or_else(|| Error::refused("No upstream configured"))?;
    let upstream = resolve(repo, upstream_name).await?;
    let fast_forward = git::is_ancestor(&repo.root, git::HEAD, &upstream).await?;
    let ahead = !fast_forward && git::is_ancestor(&repo.root, &upstream, git::HEAD).await?;
    if ahead {
        return Ok(Some(0));
    }
    if !fast_forward {
        return Err(diverged(status, upstream_name));
    }
    git::run(&repo.root, &["merge", "--ff-only", &upstream], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    moved(repo, tracked, before).await
}
async fn parse_and_sync<F: Fn(&str)>(
    repo: &Repo,
    action: &str,
    progress: F,
) -> Result<Option<u32>> {
    sync(repo, SyncAction::parse(action)?, progress).await
}
pub struct ProgressTarget<'a, R: Runtime> {
    pub app: &'a AppHandle<R>,
    pub id: &'a str,
}
pub async fn sync_reporting<R: Runtime>(
    repo: &Repo,
    action: &str,
    target: ProgressTarget<'_, R>,
) -> Result<Option<u32>> {
    let ProgressTarget { app, id } = target;
    let reporter = app.clone();
    let reported = id.to_string();
    let outcome = parse_and_sync(repo, action, move |line| {
        let _ = reporter.emit(
            SYNC_PROGRESS,
            json!({"repo":reported,"message":line,"done":false}),
        );
    })
    .await;
    let message = match &outcome {
        Ok(_) => format!("{action} complete"),
        Err(error) => format!("{action} failed: {}", error.message),
    };
    app.emit(
        SYNC_PROGRESS,
        json!({"repo":id,"message":message,"done":true}),
    )
    .map_err(Error::from)?;
    outcome
}
pub struct NewBranch<'a> {
    pub name: &'a str,
    pub base: &'a str,
    pub checkout: bool,
}
pub async fn create_and_checkout(repo: &Repo, branch: NewBranch<'_>) -> Result<()> {
    create(repo, branch.name, branch.base).await?;
    if branch.checkout {
        switch(repo, branch.name).await?;
    }
    Ok(())
}
pub async fn sync<F: Fn(&str)>(
    repo: &Repo,
    action: SyncAction,
    progress: F,
) -> Result<Option<u32>> {
    let status = repo.writable().await?;
    local_remotes_only(repo).await?;
    match action {
        SyncAction::Fetch => fetch(repo, &status, &progress).await,
        SyncAction::Push => push(repo, &status, &progress).await,
        SyncAction::Pull => pull(repo, &status, &progress).await,
    }
}
async fn push_remote(repo: &Repo) -> Result<String> {
    let configured = git::run(&repo.root, &["config", "--get", "remote.pushDefault"], None)
        .await?
        .accept(&git::SUCCESS_OR_DIFFERENT)?
        .text();
    if !configured.trim().is_empty() {
        return Ok(configured.trim().into());
    }
    let remotes = git::text(&repo.root, &["remote"]).await?;
    let remotes: Vec<&str> = remotes.lines().collect();
    remotes
        .iter()
        .find(|remote| **remote == "origin")
        .or(remotes.first())
        .map(|remote| remote.to_string())
        .ok_or_else(|| Error::refused("Add a remote before pushing"))
}
async fn mergeable(repo: &Repo, name: &str) -> Result<()> {
    let current = repo.snapshot().await?.branch.clone();
    if current == git::DETACHED_LABEL {
        return Err(Error::refused("Switch to a branch before merging"));
    }
    let branch = list(repo)
        .await?
        .into_iter()
        .find(|branch| branch.name == name)
        .ok_or_else(|| Error::refused("Choose an existing branch"))?;
    if branch.current {
        return Err(Error::refused("Choose a different branch"));
    }
    if !git::succeeded(&repo.root, &["merge-base", name, git::HEAD]).await? {
        return Err(Error::refused(format!(
            "{name} shares no history with {current}"
        )));
    }
    Ok(())
}
pub async fn merge_preview(repo: &Repo, name: &str) -> Result<MergePreview> {
    mergeable(repo, name).await?;
    if git::is_ancestor(&repo.root, name, git::HEAD).await? {
        return Ok(MergePreview {
            outcome: "upToDate".into(),
            changed: 0,
            conflicts: Vec::new(),
        });
    }
    let changed = git::text(
        &repo.root,
        &[
            "diff",
            "--name-only",
            &git::symmetric_range(git::HEAD, name),
        ],
    )
    .await?
    .lines()
    .count();
    if git::is_ancestor(&repo.root, git::HEAD, name).await? {
        return Ok(MergePreview {
            outcome: "fastForward".into(),
            changed,
            conflicts: Vec::new(),
        });
    }
    let Some(text) = git::merge_conflicts(&repo.root, git::HEAD, name).await? else {
        return Ok(MergePreview {
            outcome: "commit".into(),
            changed,
            conflicts: Vec::new(),
        });
    };
    Ok(MergePreview {
        outcome: "conflict".into(),
        changed,
        conflicts: text
            .split("\n\n")
            .next()
            .unwrap_or_default()
            .lines()
            .skip(1)
            .map(str::to_owned)
            .collect(),
    })
}
pub async fn merge(repo: &Repo, name: &str) -> Result<bool> {
    repo.writable().await?;
    mergeable(repo, name).await?;
    let output = git::run(&repo.root, &["merge", "--no-edit", name], None)
        .await?
        .accept(&git::SUCCESS_OR_DIFFERENT)?;
    let conflicted = merging(repo).await?;
    if output.code == git::EXIT_DIFFERENT && !conflicted {
        return Err(Error::git(output.message()));
    }
    Ok(!conflicted)
}
async fn merging(repo: &Repo) -> Result<bool> {
    git::succeeded(&repo.root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).await
}
pub async fn abort(repo: &Repo) -> Result<()> {
    if !merging(repo).await? {
        return Err(Error::refused("No merge is in progress"));
    }
    git::run(&repo.root, &["merge", "--abort"], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
async fn local_exists(repo: &Repo, name: &str) -> Result<bool> {
    git::ref_exists(&repo.root, &git::local_branch(name)).await
}
pub async fn default_branch(repo: &Repo) -> Result<String> {
    let head = git::run(
        &repo.root,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        None,
    )
    .await?;
    if head.succeeded() {
        let remote = head.text().trim().to_owned();
        let local = git::without_remote(&remote);
        if local_exists(repo, local).await? {
            return Ok(local.into());
        }
        return Ok(remote);
    }
    for name in ["main", "master"] {
        if local_exists(repo, name).await? {
            return Ok(name.into());
        }
    }
    Ok(repo.snapshot().await?.branch.clone())
}
