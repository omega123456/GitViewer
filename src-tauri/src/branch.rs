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
}
pub async fn list(repo: &Repo) -> Result<Vec<Branch>> {
    let text = git::text(
        &repo.root,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(HEAD)%00%(upstream:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )
    .await?;
    Ok(text
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\0').collect();
            if fields.len() != 3 || fields[0].ends_with("/HEAD") {
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
            })
        })
        .collect())
}
pub async fn switch(repo: &mut Repo, name: &str) -> Result<()> {
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
pub async fn create(repo: &mut Repo, name: &str, base: &str) -> Result<()> {
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
pub async fn delete(repo: &mut Repo, name: &str) -> Result<()> {
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
pub async fn sync<F: Fn(&str)>(repo: &mut Repo, action: &str, progress: F) -> Result<()> {
    repo.writable().await?;
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
    if action != "fetch" && repo.status.branch == "(detached)" {
        return Err(Error::refused("Detached HEAD has no upstream branch"));
    }
    match action {
        "fetch" => {
            git::stream(&repo.root, &["fetch", "--all", "--progress"], &progress)
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
            let upstream = repo
                .status
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
                    return Ok(());
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
    Ok(())
}
