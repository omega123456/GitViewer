use crate::{error::Result, git};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub name: String,
    pub main: bool,
    pub bare: bool,
    pub branch: String,
    pub oid: String,
    pub detached: bool,
    pub locked: Option<String>,
    pub prunable: bool,
    pub missing: bool,
}

pub fn canonical(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

fn parse(main: bool, record: &str) -> Worktree {
    let mut worktree = Worktree {
        main,
        ..Worktree::default()
    };
    for line in record.split('\0') {
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "worktree" => {
                let path = canonical(value);
                worktree.missing = !path.exists();
                worktree.name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                worktree.id = path.to_string_lossy().into_owned();
            }
            "HEAD" => worktree.oid = value.into(),
            "branch" => worktree.branch = value.trim_start_matches("refs/heads/").into(),
            "detached" => worktree.detached = true,
            "bare" => worktree.bare = true,
            "locked" => worktree.locked = Some(value.into()),
            _ => worktree.prunable |= key == "prunable",
        }
    }
    worktree
}

pub async fn list(root: &Path) -> Result<Vec<Worktree>> {
    let text = git::text(root, &["worktree", "list", "--porcelain", "-z"]).await?;
    Ok(text
        .split("\0\0")
        .filter(|record| !record.is_empty())
        .enumerate()
        .map(|(index, record)| parse(index == 0, record))
        .collect())
}

pub async fn prune(root: &Path) -> Result<()> {
    git::text(root, &["worktree", "prune"]).await?;
    Ok(())
}
