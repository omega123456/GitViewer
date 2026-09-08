use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
};

pub async fn files(repo: &mut Repo, paths: &[String], action: &str) -> Result<()> {
    repo.writable().await?;
    if paths.is_empty() {
        return Err(Error::refused("Select a file first"));
    }
    for path in paths {
        repo.path(path)?;
    }
    let mut selected = paths.to_vec();
    if action == "unstage" || action == "revert" {
        for entry in &repo.status.entries {
            if paths.iter().any(|path| path == entry.path()) {
                if let Some(original) = entry.original_path() {
                    if !selected.iter().any(|path| path == original) {
                        selected.push(original.into());
                    }
                }
            }
        }
    }
    let input: Vec<u8> = selected.iter().flat_map(|p| p.bytes().chain([0])).collect();
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
            let unborn = repo.status.oid == "(initial)";
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
            let mut tracked = Vec::new();
            let mut added = Vec::new();
            for path in &selected {
                let entry = repo
                    .status
                    .entries
                    .iter()
                    .find(|entry| entry.path() == path);
                if entry.is_some_and(|entry| entry.index() == "?" || entry.index() == "A") {
                    added.push(path.clone());
                } else {
                    tracked.push(path.clone());
                }
            }
            // Restore both sides of renames and all tracked changes to HEAD.
            if !tracked.is_empty() {
                let input: Vec<u8> = tracked.iter().flat_map(|p| p.bytes().chain([0])).collect();
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
                    Some(&input),
                )
                .await?
                .accept(&[0])?;
            }
            for path in added {
                if repo
                    .status
                    .entries
                    .iter()
                    .any(|entry| entry.path() == path && entry.index() == "A")
                {
                    let input: Vec<u8> = path.bytes().chain([0]).collect();
                    git::run(
                        &repo.root,
                        &[
                            "rm",
                            "--cached",
                            "--force",
                            "--pathspec-from-file=-",
                            "--pathspec-file-nul",
                        ],
                        Some(&input),
                    )
                    .await?
                    .accept(&[0])?;
                }
                let absolute = repo.path(&path)?;
                match std::fs::remove_file(absolute) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        "discard" => {
            if paths.iter().any(|path| {
                repo.status
                    .entries
                    .iter()
                    .any(|e| e.path() == path && e.index() == "?")
            }) {
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
pub async fn commit(repo: &mut Repo, message: &str) -> Result<()> {
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
    Ok(())
}
