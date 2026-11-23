use crate::{
    branch,
    diff::resolve,
    error::{Error, Result},
    git,
    repo::Repo,
    status::Status,
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
const STASH_FORMAT: &str = "--format=%H%x00%gd%x00%at%x00%gs";
const STASH_FIELDS: usize = 4;
pub async fn list(repo: &Repo) -> Result<Vec<Stash>> {
    let text = git::text(&repo.root, &["stash", "list", STASH_FORMAT]).await?;
    Ok(text
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.splitn(STASH_FIELDS, git::NUL).collect();
            if fields.len() != STASH_FIELDS {
                return None;
            }
            Some(Stash {
                hash: fields[0].into(),
                selector: fields[1].into(),
                timestamp: fields[2].parse().unwrap_or_default(),
                message: fields[3].into(),
            })
        })
        .collect())
}
pub async fn save(repo: &Repo, message: &str) -> Result<String> {
    if repo.writable().await?.entries.is_empty() {
        return Err(Error::refused("There are no changes to stash"));
    }
    git::run(
        &repo.root,
        &["stash", "push", "--include-untracked", "--message", message],
        None,
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?;
    resolve(repo, "refs/stash").await
}
pub async fn remove(repo: &Repo, hash: &str) -> Result<()> {
    repo.writable().await?;
    let stashes = list(repo).await?;
    let stash = stashes
        .iter()
        .find(|stash| stash.hash == hash)
        .ok_or_else(|| Error::refused("Stash no longer exists"))?;
    git::run(&repo.root, &["stash", "drop", &stash.selector], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
pub async fn store(repo: &Repo, hash: &str, message: &str) -> Result<()> {
    repo.writable().await?;
    git::run(
        &repo.root,
        &["stash", "store", "--message", message, hash],
        None,
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?;
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
            &git::first_parent(hash),
            hash,
        ],
    )
    .await?;
    let mut paths: HashSet<String> = text
        .split(git::NUL)
        .filter(|path| !path.is_empty())
        .map(String::from)
        .collect();
    paths.extend(untracked(repo, hash).await?);
    Ok(paths)
}
fn directories(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices(git::PATH_SEPARATOR)
        .map(|(offset, _)| &path[..offset])
}
pub fn overlapping(status: &Status, target: &HashSet<String>) -> Vec<String> {
    let containing: HashSet<&str> = target.iter().flat_map(|path| directories(path)).collect();
    let shared = |path: &str| {
        target.contains(path)
            || containing.contains(path)
            || directories(path).any(|directory| target.contains(directory))
    };
    status
        .entries
        .iter()
        .filter(|entry| shared(entry.path()) || entry.original_path().is_some_and(shared))
        .map(|entry| entry.path().to_string())
        .collect()
}
pub async fn untracked(repo: &Repo, hash: &str) -> Result<Vec<String>> {
    let third = git::run(
        &repo.root,
        &["rev-parse", "--verify", &git::stash_untracked(hash)],
        None,
    )
    .await?;
    if third.code != git::EXIT_SUCCESS {
        return Ok(Vec::new());
    }
    Ok(git::text(
        &repo.root,
        &["ls-tree", "-r", "--name-only", "-z", third.text().trim()],
    )
    .await?
    .split(git::NUL)
    .filter(|path| !path.is_empty())
    .map(String::from)
    .collect())
}
pub async fn precheck(repo: &Repo, hash: &str) -> Result<()> {
    let sha = resolve(repo, hash).await?;
    let head_tree = git::text(&repo.root, &["rev-parse", &git::tree_of(git::HEAD)]).await?;
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
            &git::first_parent(&sha),
        ],
        Some(b"GitViewer stash preflight\n"),
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?
    .text();
    for target in [sha.clone(), git::stash_index(&sha)] {
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
        .accept(&[git::EXIT_SUCCESS, git::EXIT_DIFFERENT])?;
        if output.code == git::EXIT_DIFFERENT {
            return Err(Error::refused(format!(
                "Stash would conflict:\n{}",
                output.text()
            )));
        }
    }
    let index_patch = git::run(
        &repo.root,
        &[
            "diff",
            "--binary",
            &git::first_parent(&sha),
            &git::stash_index(&sha),
        ],
        None,
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?;
    if !index_patch.bytes.is_empty() {
        git::run(
            &repo.root,
            &["apply", "--cached", "--check"],
            Some(&index_patch.bytes),
        )
        .await?
        .accept(&[git::EXIT_SUCCESS])
        .map_err(|error| {
            Error::refused(format!(
                "Staged changes cannot be restored safely: {}",
                error.message
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
pub(crate) async fn restore(repo: &Repo, hash: &str) -> Result<()> {
    precheck(repo, hash).await?;
    git::run(&repo.root, &["stash", "apply", "--index", hash], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
pub async fn apply(repo: &Repo, hash: &str, pop: bool, smart: bool) -> Result<()> {
    let status = repo.writable().await?;
    if !list(repo).await?.iter().any(|stash| stash.hash == hash) {
        return Err(Error::refused("Stash no longer exists"));
    }
    if !status.entries.is_empty() {
        if !smart {
            return Err(Error::new(
                "smart_apply",
                "Local changes need a smart apply",
            ));
        }
        let overlap = overlapping(&status, &changed_paths(repo, hash).await?);
        if !overlap.is_empty() {
            return Err(Error::refused(format!(
                "Stashes share paths: {}",
                overlap.join(", ")
            )));
        }
    }
    let mut arguments = vec!["stash", "apply"];
    if precheck(repo, hash).await.is_ok() {
        arguments.push("--index");
    }
    arguments.push(hash);
    let output = git::run(&repo.root, &arguments, None)
        .await?
        .accept(&[git::EXIT_SUCCESS, git::EXIT_DIFFERENT])?;
    if output.code == git::EXIT_DIFFERENT {
        if repo.refresh().await?.conflicted {
            return Ok(());
        }
        return Err(Error::git(output.message()));
    }
    if pop {
        remove(repo, hash).await?;
    }
    Ok(())
}
pub async fn smart_checkout(repo: &Repo, name: &str) -> Result<()> {
    let status = repo.writable().await?;
    let original = if status.branch == git::DETACHED_LABEL {
        status.oid.clone()
    } else {
        status.branch.clone()
    };
    let temporary = save(repo, "GitViewer: smart checkout").await?;
    let switched = branch::switch(repo, name).await;
    let outcome = match switched {
        Ok(()) => restore(repo, &temporary).await,
        Err(failure) => Err(failure),
    };
    if let Err(error) = outcome {
        git::run(&repo.root, &["checkout", &original, "--"], None)
            .await?
            .accept(&[git::EXIT_SUCCESS])?;
        restore(repo, &temporary).await.map_err(|failure| {
            Error::new(
                "unexpected",
                format!(
                    "Changes remain recoverable in stash {temporary}. {}",
                    failure.message
                ),
            )
        })?;
        remove(repo, &temporary).await?;
        return Err(Error::refused(format!(
            "Returned to {original}. {}",
            error.message
        )));
    }
    remove(repo, &temporary).await?;
    Ok(())
}
