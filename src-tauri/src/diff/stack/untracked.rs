use super::{
    Stack,
    record::controlled,
    stream::{Stream, batch},
};
use crate::{
    diff::{Diff, DiffSource, LINE_LIMIT, dimensions, size_limit},
    error::Result,
    fs, git,
    media::is_image,
    repo::{Paths, Repo},
    status::{Entry, Status},
};
use std::path::Path;

const TREE_ENTRY_SEPARATOR: char = '\t';
const BLOB_KIND: &str = "blob";

pub struct UntrackedEntry {
    pub path: String,
    oid: String,
    size: usize,
}
fn parse_tree_entry(entry: &str) -> Option<UntrackedEntry> {
    let (meta, path) = entry.split_once(TREE_ENTRY_SEPARATOR)?;
    let mut fields = meta.split_whitespace();
    let _mode = fields.next()?;
    let kind = fields.next()?;
    let oid = fields.next()?;
    let size = fields.next()?;
    (kind == BLOB_KIND).then(|| UntrackedEntry {
        path: path.to_owned(),
        oid: oid.to_owned(),
        size: size.parse().unwrap_or(usize::MAX),
    })
}
async fn listing(repo: &Repo, sha: &str) -> Result<Vec<UntrackedEntry>> {
    Ok(git::untracked_in_stash(&repo.root, sha, &["-l"])
        .await?
        .iter()
        .filter_map(|entry| parse_tree_entry(entry))
        .collect())
}
pub async fn stash_listing(
    repo: &Repo,
    source: DiffSource,
    sha: &str,
) -> Result<Vec<UntrackedEntry>> {
    if source != DiffSource::Stash {
        return Ok(Vec::new());
    }
    listing(repo, sha).await
}
pub fn working_size(full: &Path) -> Option<usize> {
    fs::size_if_present(full).ok()
}
pub fn working_bytes(full: &Path) -> Option<Vec<u8>> {
    fs::read_if_present(full).ok()
}
fn within_limit(path: &str, size: usize) -> bool {
    size <= size_limit(is_image(path))
}

struct UntrackedFile<'a> {
    path: &'a str,
    source: DiffSource,
    size: usize,
    bytes: Option<Vec<u8>>,
}
struct SizedDiff {
    diff: Diff,
    cost: usize,
}
impl SizedDiff {
    fn free(diff: Diff) -> Self {
        Self { diff, cost: 0 }
    }
}
fn text_content(entry: Diff, bytes: &[u8]) -> SizedDiff {
    let text = String::from_utf8_lossy(bytes);
    let lines = fs::count_lines(&text);
    if lines > LINE_LIMIT {
        return SizedDiff::free(Diff {
            too_large: true,
            ..entry
        });
    }
    SizedDiff {
        diff: Diff {
            content: Some(text.into_owned()),
            added: true,
            ..entry
        },
        cost: lines,
    }
}
fn content(file: UntrackedFile<'_>) -> SizedDiff {
    let entry = Diff {
        image: is_image(file.path),
        new_size: file.size,
        ..Diff::empty(file.path, file.source)
    };
    let Some(bytes) = file.bytes else {
        return SizedDiff::free(Diff {
            too_large: true,
            ..entry
        });
    };
    if entry.image {
        return SizedDiff::free(Diff {
            new_dimensions: dimensions(&bytes),
            ..entry
        });
    }
    if fs::is_binary(&bytes) {
        return SizedDiff::free(Diff {
            binary: true,
            ..entry
        });
    }
    text_content(entry, &bytes)
}

pub struct Collector {
    pub stack: Stack,
    budget: usize,
}
impl Collector {
    pub fn new(stack: Stack, budget: usize) -> Self {
        Self { stack, budget }
    }
    fn admit(&mut self, file: UntrackedFile<'_>) -> bool {
        let sized = content(file);
        if sized.cost > self.budget {
            self.stack.truncated = true;
            return false;
        }
        self.budget -= sized.cost;
        self.stack.files.insert(sized.diff.path.clone(), sized.diff);
        true
    }
}

fn is_regular_or_link(full: &Path) -> bool {
    std::fs::symlink_metadata(full)
        .map(|meta| meta.file_type())
        .is_ok_and(|kind| kind.is_file() || kind.is_symlink())
}
fn worktree_file<'a>(entry: &'a Entry, paths: &mut Paths<'_>) -> Option<UntrackedFile<'a>> {
    let Entry::Untracked { path, .. } = entry else {
        return None;
    };
    let full = paths.resolve(path).ok().filter(|_| !controlled(path))?;
    if !is_regular_or_link(&full) {
        return None;
    }
    let size = working_size(&full)?;
    let too_large = UntrackedFile {
        path,
        source: DiffSource::File,
        size,
        bytes: None,
    };
    if !within_limit(path, size) {
        return Some(too_large);
    }
    Some(UntrackedFile {
        bytes: Some(working_bytes(&full)?),
        ..too_large
    })
}
pub fn add_worktree_untracked(collector: &mut Collector, status: &Status, paths: &mut Paths<'_>) {
    for entry in &status.entries {
        let Some(file) = worktree_file(entry, paths) else {
            continue;
        };
        if !collector.admit(file) {
            return;
        }
    }
}

fn readable(entry: &UntrackedEntry, paths: &mut Paths<'_>) -> bool {
    !controlled(&entry.path) && paths.resolve(&entry.path).is_ok()
}
fn open_objects(repo: &Repo, wanted: &[&str]) -> Result<Option<Stream>> {
    if wanted.is_empty() {
        return Ok(None);
    }
    batch(repo, wanted).map(Some)
}
async fn stash_file<'a>(
    objects: Option<&mut Stream>,
    entry: &'a UntrackedEntry,
) -> Result<Option<UntrackedFile<'a>>> {
    let too_large = UntrackedFile {
        path: &entry.path,
        source: DiffSource::Stash,
        size: entry.size,
        bytes: None,
    };
    let loadable = objects.filter(|_| within_limit(&entry.path, entry.size));
    let Some(stream) = loadable else {
        return Ok(Some(too_large));
    };
    let Some(bytes) = stream.object().await? else {
        return Ok(None);
    };
    Ok(Some(UntrackedFile {
        bytes: Some(bytes),
        ..too_large
    }))
}
pub async fn add_stash_untracked(
    repo: &Repo,
    collector: &mut Collector,
    readable_entries: Vec<&UntrackedEntry>,
) -> Result<()> {
    let wanted: Vec<&str> = readable_entries
        .iter()
        .filter(|entry| within_limit(&entry.path, entry.size))
        .map(|entry| entry.oid.as_str())
        .collect();
    let mut objects = open_objects(repo, &wanted)?;
    for entry in readable_entries {
        let Some(file) = stash_file(objects.as_mut(), entry).await? else {
            continue;
        };
        if !collector.admit(file) {
            return Ok(());
        }
    }
    Ok(())
}
pub fn readable_entries<'a>(
    untracked: &'a [UntrackedEntry],
    paths: &mut Paths<'_>,
) -> Vec<&'a UntrackedEntry> {
    untracked
        .iter()
        .filter(|entry| readable(entry, paths))
        .collect()
}
