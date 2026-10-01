use crate::{
    diff::size_limit,
    error::{Error, Result},
    git,
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

const PINNED: [&str; 4] = ["--numstat", "-z", "--no-ext-diff", "--no-textconv"];

pub fn numstat(text: &str) -> BTreeMap<String, Lines> {
    let mut lines = BTreeMap::new();
    let mut fields = text.split('\0');
    while let Some(record) = fields.next() {
        let mut parts = record.splitn(3, '\t');
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
    staged.extend(PINNED);
    let mut unstaged = vec!["diff-files", "--no-renames"];
    unstaged.extend(PINNED);
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
    let mut cache = repo
        .untracked_lines
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        if !metadata.is_file() || metadata.len() > size_limit(false) as u64 {
            continue;
        }
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let lines = match cache.remove(path) {
            Some((len, time, lines)) if len == metadata.len() && time == modified => lines,
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
    if bytes.contains(&0) {
        return None;
    }
    let newlines = bytes.iter().filter(|byte| **byte == b'\n').count();
    let open = bytes.last().is_some_and(|byte| *byte != b'\n');
    Some([(newlines + usize::from(open)) as u32, 0])
}
