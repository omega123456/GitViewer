use crate::{
    diff::size_limit,
    error::{Error, Result},
    fs, git,
    lock::lock_recovering,
    repo::{Paths, Repository},
    status::Entry,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    time::SystemTime,
};

pub type Lines = Option<[u32; 2]>;
#[derive(Clone, Copy, Debug)]
pub struct CachedCount {
    size: u64,
    modified: SystemTime,
    lines: Lines,
}
impl CachedCount {
    fn matches(&self, size: u64, modified: SystemTime) -> bool {
        self.size == size && self.modified == modified
    }
}

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
        let path = record_path(path, &mut fields);
        lines.insert(path.to_owned(), counts(added, deleted));
    }
    lines
}
fn record_path<'a>(path: &'a str, fields: &mut impl Iterator<Item = &'a str>) -> &'a str {
    if !path.is_empty() {
        return path;
    }
    fields.next();
    fields.next().unwrap_or_default()
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

struct CountableFile<'a> {
    path: &'a String,
    full: PathBuf,
    size: u64,
    modified: SystemTime,
}
fn countable_file<'a>(entry: &'a Entry, paths: &mut Paths<'_>) -> Option<CountableFile<'a>> {
    let Entry::Untracked { path, .. } = entry else {
        return None;
    };
    let full = paths.resolve(path).ok()?;
    let metadata = std::fs::metadata(&full).ok()?;
    let limit = u64::try_from(size_limit(false)).unwrap_or(u64::MAX);
    let countable = metadata.is_file() && metadata.len() <= limit;
    if !countable {
        return None;
    }
    Some(CountableFile {
        path,
        full,
        size: metadata.len(),
        modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
    })
}
fn file_lines(file: &CountableFile<'_>, cached: Option<CachedCount>) -> Option<Lines> {
    let fresh = cached.filter(|cached| cached.matches(file.size, file.modified));
    if let Some(cached) = fresh {
        return Some(cached.lines);
    }
    std::fs::read(&file.full).ok().map(|bytes| count(&bytes))
}
fn untracked(repo: &Repository, entries: &[Entry]) -> BTreeMap<String, Lines> {
    let mut cache = lock_recovering(&repo.untracked_lines);
    let mut kept = HashMap::new();
    let mut paths = repo.paths();
    let mut counted = BTreeMap::new();
    for entry in entries {
        let Some(file) = countable_file(entry, &mut paths) else {
            continue;
        };
        let Some(lines) = file_lines(&file, cache.remove(file.path)) else {
            continue;
        };
        let cached = CachedCount {
            size: file.size,
            modified: file.modified,
            lines,
        };
        kept.insert(file.path.clone(), cached);
        counted.insert(file.path.clone(), lines);
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
