use crate::{
    branch,
    diff::resolve,
    error::{Error, Result},
    git,
    repo::Repo,
};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Serialize)]
pub struct Stash {
    pub hash: String,
    pub selector: String,
    pub message: String,
    pub timestamp: i64,
}
pub async fn list(repo: &Repo) -> Result<Vec<Stash>> {
    let text = git::text(
        &repo.root,
        &["stash", "list", "--format=%H%x00%gd%x00%at%x00%gs"],
    )
    .await?;
    Ok(text
        .lines()
        .filter_map(|line| {
            let p: Vec<&str> = line.splitn(4, '\0').collect();
            if p.len() != 4 {
                return None;
            }
            Some(Stash {
                hash: p[0].into(),
                selector: p[1].into(),
                timestamp: p[2].parse().unwrap_or_default(),
                message: p[3].into(),
            })
        })
        .collect())
}
pub async fn save(repo: &mut Repo, message: &str) -> Result<String> {
    repo.writable().await?;
    if repo.status.entries.is_empty() {
        return Err(Error::refused("There are no changes to stash"));
    }
    git::run(
        &repo.root,
        &["stash", "push", "--include-untracked", "--message", message],
        None,
    )
    .await?
    .accept(&[0])?;
    resolve(repo, "refs/stash").await
}
pub async fn drop(repo: &mut Repo, hash: &str) -> Result<()> {
    repo.writable().await?;
    let stashes = list(repo).await?;
    let stash = stashes
        .iter()
        .find(|s| s.hash == hash)
        .ok_or_else(|| Error::refused("Stash no longer exists"))?;
    git::run(&repo.root, &["stash", "drop", &stash.selector], None)
        .await?
        .accept(&[0])?;
    Ok(())
}
async fn changed_paths(repo: &Repo, hash: &str) -> Result<HashSet<String>> {
    let text = git::text(
        &repo.root,
        &[
            "diff",
            "--no-renames",
            "--name-only",
            "-z",
            &format!("{hash}^1"),
            hash,
        ],
    )
    .await?;
    let mut paths: HashSet<String> = text
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    paths.extend(untracked(repo, hash).await?);
    Ok(paths)
}
pub async fn untracked(repo: &Repo, hash: &str) -> Result<Vec<String>> {
    let third = git::run(
        &repo.root,
        &["rev-parse", "--verify", &format!("{hash}^3")],
        None,
    )
    .await?;
    if third.code != 0 {
        return Ok(Vec::new());
    }
    Ok(git::text(
        &repo.root,
        &["ls-tree", "-r", "--name-only", "-z", third.text().trim()],
    )
    .await?
    .split('\0')
    .filter(|s| !s.is_empty())
    .map(String::from)
    .collect())
}
pub async fn precheck(repo: &Repo, hash: &str) -> Result<()> {
    let sha = resolve(repo, hash).await?;
    let head_tree = git::text(&repo.root, &["rev-parse", "HEAD^{tree}"]).await?;
    let head = git::run(
        &repo.root,
        &[
            "-c",
            "user.name=GitViewer",
            "-c",
            "user.email=gitviewer@localhost",
            "commit-tree",
            head_tree.trim(),
            "-p",
            &format!("{sha}^1"),
        ],
        Some(b"GitViewer stash preflight\n"),
    )
    .await?
    .accept(&[0])?
    .text();
    for target in [sha.clone(), format!("{sha}^2")] {
        let output = git::run(
            &repo.root,
            &[
                "merge-tree",
                "--write-tree",
                "--name-only",
                head.trim(),
                &target,
            ],
            None,
        )
        .await?
        .accept(&[0, 1])?;
        if output.code == 1 {
            return Err(Error::refused(format!(
                "Stash would conflict:\n{}",
                output.text()
            )));
        }
    }
    let index_patch = git::run(
        &repo.root,
        &["diff", "--binary", &format!("{sha}^1"), &format!("{sha}^2")],
        None,
    )
    .await?
    .accept(&[0])?;
    if !index_patch.bytes.is_empty() {
        git::run(
            &repo.root,
            &["apply", "--cached", "--check"],
            Some(&index_patch.bytes),
        )
        .await?
        .accept(&[0])
        .map_err(|e| {
            Error::refused(format!(
                "Staged changes cannot be restored safely: {}",
                e.message
            ))
        })?;
    }
    for path in untracked(repo, &sha).await? {
        if repo.path(&path)?.exists() {
            return Err(Error::refused(format!(
                "Stash would overwrite untracked path: {path}"
            )));
        }
    }
    Ok(())
}
async fn restore(repo: &mut Repo, hash: &str) -> Result<()> {
    precheck(repo, hash).await?;
    git::run(&repo.root, &["stash", "apply", "--index", hash], None)
        .await?
        .accept(&[0])?;
    Ok(())
}
pub async fn apply(repo: &mut Repo, hash: &str, pop: bool, smart: bool) -> Result<()> {
    repo.writable().await?;
    if !list(repo).await?.iter().any(|s| s.hash == hash) {
        return Err(Error::refused("Stash no longer exists"));
    }
    if !repo.status.entries.is_empty() {
        if !smart {
            return Err(Error::new(
                "smart_apply",
                "Local changes need a smart apply",
            ));
        }
        let target = changed_paths(repo, hash).await?;
        let overlap: Vec<_> = repo
            .status
            .entries
            .iter()
            .filter(|e| {
                target.iter().any(|path| {
                    path == e.path()
                        || path.starts_with(&format!("{}/", e.path()))
                        || e.path().starts_with(&format!("{path}/"))
                        || e.original_path().is_some_and(|original| {
                            original == path
                                || path.starts_with(&format!("{original}/"))
                                || original.starts_with(&format!("{path}/"))
                        })
                })
            })
            .map(|e| e.path().to_string())
            .collect();
        if !overlap.is_empty() {
            return Err(Error::refused(format!(
                "Stashes share paths: {}",
                overlap.join(", ")
            )));
        }
    }
    let mut args = vec!["stash", "apply"];
    if precheck(repo, hash).await.is_ok() {
        args.push("--index");
    }
    args.push(hash);
    let output = git::run(&repo.root, &args, None).await?.accept(&[0, 1])?;
    if output.code == 1 {
        if repo.refresh().await?.conflicted {
            return Ok(());
        }
        return Err(Error::git(output.message()));
    }
    if pop {
        drop(repo, hash).await?;
    }
    Ok(())
}
pub async fn smart_checkout(repo: &mut Repo, name: &str) -> Result<()> {
    repo.writable().await?;
    let original = if repo.status.branch == "(detached)" {
        repo.status.oid.clone()
    } else {
        repo.status.branch.clone()
    };
    let temporary = save(repo, "GitViewer: smart checkout").await?;
    let switched = branch::switch(repo, name).await;
    let outcome = match switched {
        Ok(()) => restore(repo, &temporary).await,
        Err(e) => Err(e),
    };
    if let Err(error) = outcome {
        git::run(&repo.root, &["checkout", &original, "--"], None)
            .await?
            .accept(&[0])?;
        restore(repo, &temporary).await.map_err(|e| {
            Error::new(
                "unexpected",
                format!(
                    "Changes remain recoverable in stash {temporary}. {}",
                    e.message
                ),
            )
        })?;
        drop(repo, &temporary).await?;
        return Err(Error::refused(format!(
            "Returned to {original}. {}",
            error.message
        )));
    }
    drop(repo, &temporary).await?;
    Ok(())
}
