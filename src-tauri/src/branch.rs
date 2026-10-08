use crate::{
    diff::resolve,
    error::{Error, Result},
    git,
    repo::Repo,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Branch {
    pub name: String,
    pub remote: bool,
    pub current: bool,
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
pub async fn list(repo: &Repo) -> Result<Vec<Branch>> {
    let text = git::text(
        &repo.root,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(worktreepath)%00%(upstream:track)",
            "refs/heads",
            "refs/remotes",
        ],
    )
    .await?;
    Ok(text
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\0').collect();
            if fields.len() != 5 || fields[0].ends_with("/HEAD") {
                return None;
            }
            Some(Branch {
                name: fields[0]
                    .trim_start_matches("refs/heads/")
                    .trim_start_matches("refs/remotes/")
                    .into(),
                remote: fields[0].starts_with("refs/remotes/"),
                current: fields[1] == "*",
                upstream: fields[2].into(),
                gone: fields[4] == "[gone]",
                worktree: Some(fields[3])
                    .filter(|path| !path.is_empty())
                    .map(|path| {
                        crate::worktree::canonical(path)
                            .to_string_lossy()
                            .into_owned()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect())
}
pub async fn switch(repo: &Repo, name: &str) -> Result<()> {
    repo.writable().await?;
    let branches = list(repo).await?;
    let branch = branches
        .iter()
        .find(|branch| branch.name == name)
        .ok_or_else(|| Error::refused("Choose an existing branch"))?;
    let mut target = name;
    let mut args = vec!["checkout"];
    if branch.remote {
        let (_, local) = name
            .split_once('/')
            .ok_or_else(|| Error::refused("Invalid remote branch"))?;
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
            args.extend(["--track", "-b", local]);
        }
    }
    args.extend([target, "--"]);
    git::run(&repo.root, &args, None).await?.accept(&[0])?;
    Ok(())
}
pub async fn create(repo: &Repo, name: &str, base: &str) -> Result<()> {
    repo.writable().await?;
    git::run(&repo.root, &["check-ref-format", "--branch", name], None)
        .await?
        .accept(&[0])?;
    let base = resolve(repo, base).await?;
    git::run(&repo.root, &["branch", name, &base], None)
        .await?
        .accept(&[0])?;
    Ok(())
}
pub async fn delete(repo: &Repo, name: &str) -> Result<()> {
    repo.writable().await?;
    let branches = list(repo).await?;
    let branch = branches
        .iter()
        .find(|b| b.name == name)
        .ok_or_else(|| Error::refused("Branch no longer exists"))?;
    if branch.current {
        return Err(Error::refused(
            "Switch away from this branch before deleting it",
        ));
    }
    if branch.remote {
        let sha = resolve(repo, &format!("refs/remotes/{name}")).await?;
        git::run(
            &repo.root,
            &["merge-base", "--is-ancestor", &sha, "HEAD"],
            None,
        )
        .await?
        .accept(&[0])
        .map_err(|_| Error::refused("Remote branch is not fully merged into HEAD"))?;
        let (remote, branch) = name
            .split_once('/')
            .ok_or_else(|| Error::refused("Invalid remote branch"))?;
        git::run(&repo.root, &["push", remote, "--delete", branch], None)
            .await?
            .accept(&[0])?;
    } else {
        git::run(&repo.root, &["branch", "-d", "--", name], None)
            .await?
            .accept(&[0])?;
    }
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
        .filter(|b| {
            !b.remote
                && b.gone
                && !b.current
                && b.worktree.is_empty()
                && default.as_deref() != Some(b.name.as_str())
        })
        .map(|b| b.name)
        .collect())
}
pub async fn gone(repo: &Repo) -> Result<Vec<String>> {
    repo.writable().await?;
    local_remotes_only(repo).await?;
    git::run(&repo.root, &["fetch", "--all", "--prune"], None)
        .await?
        .accept(&[0])?;
    candidates(repo).await
}
pub async fn prune(repo: &Repo, names: Vec<String>) -> Result<Pruned> {
    repo.writable().await?;
    let allowed = candidates(repo).await?;
    let targets: Vec<String> = names.into_iter().filter(|n| allowed.contains(n)).collect();
    for chunk in targets.chunks(100) {
        let mut args = vec!["branch", "-d", "--"];
        args.extend(chunk.iter().map(String::as_str));
        git::run(&repo.root, &args, None).await?.accept(&[0, 1])?;
    }
    let remaining: Vec<String> = list(repo).await?.into_iter().map(|b| b.name).collect();
    let (kept, deleted) = targets.into_iter().partition(|n| remaining.contains(n));
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
        &["rev-list", "--count", &format!("{from}..{to}")],
    )
    .await?;
    Ok(count.trim().parse().ok())
}
pub async fn sync<F: Fn(&str)>(repo: &Repo, action: &str, progress: F) -> Result<Option<u32>> {
    let status = repo.writable().await?;
    local_remotes_only(repo).await?;
    if action != "fetch" && status.branch == "(detached)" {
        return Err(Error::refused("Detached HEAD has no upstream branch"));
    }
    let tracked = match action {
        "pull" => Some("HEAD".to_string()),
        _ => status.upstream.clone(),
    };
    let before = tip(repo, tracked.as_deref()).await;
    match action {
        "fetch" => {
            git::stream(&repo.root, &["fetch", "--all", "--progress"], &progress)
                .await?
                .accept(&[0])?;
        }
        "push" if status.upstream.is_none() => {
            let remote = push_remote(repo).await?;
            git::stream(
                &repo.root,
                &["push", "--progress", "--set-upstream", &remote, "HEAD"],
                &progress,
            )
            .await?
            .accept(&[0])?;
        }
        "push" => {
            git::stream(&repo.root, &["push", "--progress"], &progress)
                .await?
                .accept(&[0])?;
        }
        "pull" => {
            git::stream(&repo.root, &["fetch", "--progress"], &progress)
                .await?
                .accept(&[0])?;
            let upstream = status
                .upstream
                .as_deref()
                .ok_or_else(|| Error::refused("No upstream configured"))?;
            let upstream = resolve(repo, upstream).await?;
            let ancestor = git::run(
                &repo.root,
                &["merge-base", "--is-ancestor", "HEAD", &upstream],
                None,
            )
            .await?
            .accept(&[0, 1])?;
            if ancestor.code == 1 {
                let ahead = git::run(
                    &repo.root,
                    &["merge-base", "--is-ancestor", &upstream, "HEAD"],
                    None,
                )
                .await?
                .accept(&[0, 1])?;
                if ahead.code == 0 {
                    return Ok(Some(0));
                }
                return Err(Error::refused(
                    "Pull cannot fast-forward; resolve the diverged history in a terminal",
                ));
            }
            git::run(&repo.root, &["merge", "--ff-only", &upstream], None)
                .await?
                .accept(&[0])?;
        }
        _ => return Err(Error::refused("Unknown synchronization action")),
    }
    let after = tip(repo, tracked.as_deref()).await;
    distance(repo, before, after).await
}
async fn push_remote(repo: &Repo) -> Result<String> {
    let configured = git::run(&repo.root, &["config", "--get", "remote.pushDefault"], None)
        .await?
        .accept(&[0, 1])?
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
    if current == "(detached)" {
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
    if git::run(&repo.root, &["merge-base", name, "HEAD"], None)
        .await?
        .accept(&[0, 1])?
        .code
        == 1
    {
        return Err(Error::refused(format!(
            "{name} shares no history with {current}"
        )));
    }
    Ok(())
}
async fn ancestor(repo: &Repo, earlier: &str, later: &str) -> Result<bool> {
    Ok(git::run(
        &repo.root,
        &["merge-base", "--is-ancestor", earlier, later],
        None,
    )
    .await?
    .accept(&[0, 1])?
    .code
        == 0)
}
pub async fn merge_preview(repo: &Repo, name: &str) -> Result<MergePreview> {
    mergeable(repo, name).await?;
    if ancestor(repo, name, "HEAD").await? {
        return Ok(MergePreview {
            outcome: "upToDate".into(),
            changed: 0,
            conflicts: Vec::new(),
        });
    }
    let changed = git::text(
        &repo.root,
        &["diff", "--name-only", &format!("HEAD...{name}")],
    )
    .await?
    .lines()
    .count();
    if ancestor(repo, "HEAD", name).await? {
        return Ok(MergePreview {
            outcome: "fastForward".into(),
            changed,
            conflicts: Vec::new(),
        });
    }
    let merged = git::run(
        &repo.root,
        &["merge-tree", "--write-tree", "--name-only", "HEAD", name],
        None,
    )
    .await?
    .accept(&[0, 1])?;
    if merged.code == 0 {
        return Ok(MergePreview {
            outcome: "commit".into(),
            changed,
            conflicts: Vec::new(),
        });
    }
    let text = merged.text();
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
        .accept(&[0, 1])?;
    let conflicted = merging(repo).await?;
    if output.code == 1 && !conflicted {
        return Err(Error::git(output.message()));
    }
    Ok(!conflicted)
}
async fn merging(repo: &Repo) -> Result<bool> {
    Ok(git::run(
        &repo.root,
        &["rev-parse", "-q", "--verify", "MERGE_HEAD"],
        None,
    )
    .await?
    .accept(&[0, 1])?
    .code
        == 0)
}
pub async fn abort(repo: &Repo) -> Result<()> {
    if !merging(repo).await? {
        return Err(Error::refused("No merge is in progress"));
    }
    git::run(&repo.root, &["merge", "--abort"], None)
        .await?
        .accept(&[0])?;
    Ok(())
}
async fn local_exists(repo: &Repo, name: &str) -> Result<bool> {
    Ok(git::run(
        &repo.root,
        &["rev-parse", "--verify", &format!("refs/heads/{name}")],
        None,
    )
    .await?
    .code
        == 0)
}
pub async fn default_branch(repo: &Repo) -> Result<String> {
    let head = git::run(
        &repo.root,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        None,
    )
    .await?;
    if head.code == 0 {
        let remote = head.text().trim().to_owned();
        let local = remote
            .split_once('/')
            .map_or(remote.as_str(), |(_, name)| name);
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
