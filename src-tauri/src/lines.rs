use crate::{
    diff::size_limit,
    error::{Error, Result},
    fs, git,
    lock::lock_recovering,
    repo::Repository,
    status::Entry,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    time::SystemTime,
};

pub type Lines = Option<[u32; 2]>;
pub type Counted = (u64, SystemTime, Lines);

#[derive(Debug, Default, Serialize)]
pub struct Working {
    pub staged: BTreeMap<String, Lines>,
    pub unstaged: BTreeMap<String, Lines>,
}

const NUMSTAT_FLAGS: [&str; 2] = ["--numstat", "-z"];
const NUMSTAT_FIELDS: usize = 3;

pub fn numstat(text: &str) -> BTreeMap<String, Lines> {
    let mut lines = BTreeMap::new();
    let mut fields = text.split(git::NUL);
    while let Some(record) = fields.next() {
        let mut parts = record.splitn(NUMSTAT_FIELDS, '\t');
        let (Some(added), Some(deleted), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let path = if path.is_empty() {
            fields.next();
            fields.next().unwrap_or_default()
        } else {
            path
        };
        lines.insert(path.to_owned(), counts(added, deleted));
    }
    lines
}
fn counts(added: &str, deleted: &str) -> Lines {
    Some([added.parse().ok()?, deleted.parse().ok()?])
}

pub async fn working(repo: &Repository) -> Result<Working> {
    let mut staged = vec!["diff", "--cached", "--find-renames"];
    staged.extend(NUMSTAT_FLAGS);
    staged.extend(git::PINNED_DIFF_FLAGS);
    let mut unstaged = vec!["diff-files", "--no-renames"];
    unstaged.extend(NUMSTAT_FLAGS);
    unstaged.extend(git::PINNED_DIFF_FLAGS);
    let status = repo.snapshot().await?;
    let owner = repo.clone();
    let (staged, unstaged, untracked) = tokio::try_join!(
        git::text(&repo.root, &staged),
        git::text(&repo.root, &unstaged),
        async move {
            tokio::task::spawn_blocking(move || untracked(&owner, &status.entries))
                .await
                .map_err(Error::from)
        },
    )?;
    let mut unstaged = numstat(&unstaged);
    unstaged.extend(untracked);
    Ok(Working {
        staged: numstat(&staged),
        unstaged,
    })
}

fn untracked(repo: &Repository, entries: &[Entry]) -> Vec<(String, Lines)> {
    let mut cache = lock_recovering(&repo.untracked_lines);
    let mut kept = HashMap::new();
    let mut paths = repo.paths();
    let mut counted = Vec::new();
    for entry in entries {
        let Entry::Untracked { path, .. } = entry else {
            continue;
        };
        let Ok(full) = paths.resolve(path) else {
            continue;
        };
        let Ok(metadata) = std::fs::metadata(&full) else {
            continue;
        };
        let limit = u64::try_from(size_limit(false)).unwrap_or(u64::MAX);
        if !metadata.is_file() || metadata.len() > limit {
            continue;
        }
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let lines = match cache.remove(path) {
            Some((size, time, lines)) if size == metadata.len() && time == modified => lines,
            _ => match std::fs::read(&full) {
                Ok(bytes) => count(&bytes),
                Err(_) => continue,
            },
        };
        kept.insert(path.clone(), (metadata.len(), modified, lines));
        counted.push((path.clone(), lines));
    }
    *cache = kept;
    counted
}
pub fn count(bytes: &[u8]) -> Lines {
    if fs::is_binary(bytes) {
        return None;
    }
    let newlines = bytes.iter().filter(|byte| **byte == b'\n').count();
    let open = bytes.last().is_some_and(|byte| *byte != b'\n');
    let total = u32::try_from(newlines + usize::from(open)).unwrap_or(u32::MAX);
    Some([total, 0])
}
