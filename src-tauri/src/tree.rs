use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
};
use serde::Serialize;
use std::{collections::HashMap, sync::atomic::Ordering};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub path: String,
    pub name: String,
    pub directory: bool,
    pub ignored: bool,
    pub status: String,
}
pub async fn list(repo: &Repo, path: &str) -> Result<Vec<TreeEntry>> {
    let directory = repo.path(path)?;
    let status = repo.snapshot().await?;
    repo.directory_reads.fetch_add(1, Ordering::SeqCst);
    let mut entries = Vec::new();
    for result in std::fs::read_dir(directory)? {
        let entry = result?;
        if entry.file_name() == git::DOT_GIT {
            continue;
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| Error::new("unsupported", "A filename is not valid UTF-8"))?;
        let relative = if path.is_empty() {
            name.clone()
        } else {
            format!("{path}/{name}")
        };
        entries.push(TreeEntry {
            path: relative,
            name,
            directory: entry.file_type()?.is_dir(),
            ignored: false,
            status: String::new(),
        });
    }
    if entries.is_empty() {
        return Ok(entries);
    }
    let ignored = git::ignored(&repo.root, entries.iter().map(|entry| entry.path.as_str())).await?;
    let prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{path}{}", git::PATH_SEPARATOR)
    };
    let mut decorations = HashMap::new();
    for change in &status.entries {
        if let Some(relative) = change.path().strip_prefix(&prefix) {
            let name = relative
                .split(git::PATH_SEPARATOR)
                .next()
                .unwrap_or_default();
            let code = if change.worktree() != git::UNMODIFIED {
                change.worktree()
            } else {
                change.index()
            };
            decorations.entry(name).or_insert(code);
        }
    }
    for entry in &mut entries {
        entry.ignored = ignored.contains(&entry.path);
        if !entry.ignored {
            if let Some(code) = decorations.get(entry.name.as_str()) {
                entry.status = (*code).into();
            }
        }
    }
    entries.sort_by_cached_key(|entry| (!entry.directory, entry.name.to_lowercase()));
    Ok(entries)
}
pub async fn files(repo: &Repo, ignored: bool) -> Result<Vec<String>> {
    let mut args = vec!["ls-files", "--cached", "--others", "-z"];
    if !ignored {
        args.push("--exclude-standard");
    }
    git::nul_list(&repo.root, &args).await
}
