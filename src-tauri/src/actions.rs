use crate::{
    diff::resolve,
    error::{Error, Result},
    git,
    repo::Repo,
    status::Entry,
};
use std::collections::{HashMap, HashSet};

fn pathspec<'a>(paths: impl IntoIterator<Item = &'a String>) -> Vec<u8> {
    paths
        .into_iter()
        .flat_map(|path| path.bytes().chain([0]))
        .collect()
}
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
            if let Some(original) = entries.get(path.as_str()).and_then(|e| e.original_path()) {
                if chosen.insert(original) {
                    selected.push(original.into());
                }
            }
        }
    }
    let input = pathspec(&selected);
    match action {
        "stage" => {
            git::run(
                &repo.root,
                &["add", "--pathspec-from-file=-", "--pathspec-file-nul"],
                Some(&input),
            )
            .await?
            .accept(&[0])?;
        }
        "unstage" => {
            let unborn = status.oid == "(initial)";
            let args = if unborn {
                vec![
                    "rm",
                    "--cached",
                    "--force",
                    "--ignore-unmatch",
                    "--pathspec-from-file=-",
                    "--pathspec-file-nul",
                ]
            } else {
                vec![
                    "restore",
                    "--staged",
                    "--pathspec-from-file=-",
                    "--pathspec-file-nul",
                ]
            };
            git::run(&repo.root, &args, Some(&input))
                .await?
                .accept(&[0])?;
        }
        "revert" => {
            let index = |path: &str| entries.get(path).map(|entry| entry.index());
            let (added, tracked): (Vec<&String>, Vec<&String>) = selected
                .iter()
                .partition(|path| matches!(index(path), Some("?" | "A")));
            if !tracked.is_empty() {
                git::run(
                    &repo.root,
                    &[
                        "restore",
                        "--source=HEAD",
                        "--staged",
                        "--worktree",
                        "--pathspec-from-file=-",
                        "--pathspec-file-nul",
                    ],
                    Some(&pathspec(tracked)),
                )
                .await?
                .accept(&[0])?;
            }
            let indexed: Vec<&String> = added
                .iter()
                .copied()
                .filter(|path| index(path) == Some("A"))
                .collect();
            if !indexed.is_empty() {
                git::run(
                    &repo.root,
                    &[
                        "rm",
                        "--cached",
                        "--force",
                        "--pathspec-from-file=-",
                        "--pathspec-file-nul",
                    ],
                    Some(&pathspec(indexed)),
                )
                .await?
                .accept(&[0])?;
            }
            for path in added {
                match std::fs::remove_file(checked.resolve(path)?) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        "discard" => {
            if paths
                .iter()
                .any(|path| entries.get(path.as_str()).is_some_and(|e| e.index() == "?"))
            {
                return Err(Error::refused(
                    "Untracked files cannot be recovered by Git; discard them in your file manager",
                ));
            }
            git::run(
                &repo.root,
                &[
                    "restore",
                    "--worktree",
                    "--pathspec-from-file=-",
                    "--pathspec-file-nul",
                ],
                Some(&input),
            )
            .await?
            .accept(&[0])?;
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
    let staged = git::run(&repo.root, &["diff", "--cached", "--quiet"], None)
        .await?
        .accept(&[0, 1])?;
    if staged.code == 0 {
        return Err(Error::refused("Nothing is staged"));
    }
    git::run(
        &repo.root,
        &["commit", "--file=-"],
        Some(message.as_bytes()),
    )
    .await?
    .accept(&[0])?;
    resolve(repo, "HEAD").await
}
