use crate::{
    diff::resolve,
    error::{Error, Result},
    fs, git,
    repo::Repo,
    status::Entry,
};
use std::collections::{HashMap, HashSet};

pub async fn files(repo: &Repo, paths: &[String], action: &str) -> Result<()> {
    let status = repo.writable().await?;
    if paths.is_empty() {
        return Err(Error::refused("Select a file first"));
    }
    let mut checked = repo.paths();
    for path in paths {
        checked.resolve(path)?;
    }
    let entries: HashMap<&str, &Entry> = status
        .entries
        .iter()
        .map(|entry| (entry.path(), entry))
        .collect();
    let mut selected = paths.to_vec();
    if action == "unstage" || action == "revert" {
        let mut chosen: HashSet<&str> = paths.iter().map(String::as_str).collect();
        for path in paths {
            if let Some(original) = entries
                .get(path.as_str())
                .and_then(|entry| entry.original_path())
            {
                if chosen.insert(original) {
                    selected.push(original.into());
                }
            }
        }
    }
    let input = || selected.iter().map(String::as_str);
    match action {
        "stage" => {
            git::run_with_pathspec(&repo.root, &["add"], input()).await?;
        }
        "unstage" => {
            let unborn = status.oid == "(initial)";
            let arguments = if unborn {
                vec!["rm", "--cached", "--force", "--ignore-unmatch"]
            } else {
                vec!["restore", "--staged"]
            };
            git::run_with_pathspec(&repo.root, &arguments, input()).await?;
        }
        "revert" => {
            let index = |path: &str| entries.get(path).map(|entry| entry.index());
            let (added, tracked): (Vec<&String>, Vec<&String>) = selected
                .iter()
                .partition(|path| matches!(index(path), Some(git::UNTRACKED | "A")));
            if !tracked.is_empty() {
                git::run_with_pathspec(
                    &repo.root,
                    &["restore", "--source=HEAD", "--staged", "--worktree"],
                    tracked.iter().map(|path| path.as_str()),
                )
                .await?;
            }
            let indexed: Vec<&String> = added
                .iter()
                .copied()
                .filter(|path| index(path) == Some("A"))
                .collect();
            if !indexed.is_empty() {
                git::run_with_pathspec(
                    &repo.root,
                    &["rm", "--cached", "--force"],
                    indexed.iter().map(|path| path.as_str()),
                )
                .await?;
            }
            for path in added {
                fs::remove_if_present(&checked.resolve(path)?)?;
            }
        }
        "discard" => {
            if paths.iter().any(|path| {
                entries
                    .get(path.as_str())
                    .is_some_and(|entry| entry.index() == git::UNTRACKED)
            }) {
                return Err(Error::refused(
                    "Untracked files cannot be recovered by Git; discard them in your file manager",
                ));
            }
            git::run_with_pathspec(&repo.root, &["restore", "--worktree"], input()).await?;
        }
        _ => return Err(Error::refused("Unknown file action")),
    }
    Ok(())
}
pub async fn commit(repo: &Repo, message: &str) -> Result<String> {
    repo.writable().await?;
    if message.trim().is_empty() {
        return Err(Error::refused("Write a commit message first"));
    }
    let nothing_staged = git::succeeded(&repo.root, &["diff", "--cached", "--quiet"]).await?;
    if nothing_staged {
        return Err(Error::refused("Nothing is staged"));
    }
    git::run(
        &repo.root,
        &["commit", "--file=-"],
        Some(message.as_bytes()),
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?;
    resolve(repo, git::HEAD).await
}
