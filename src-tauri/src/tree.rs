use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
    status::{Entry, Status},
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs::DirEntry,
    path::Path,
    sync::atomic::Ordering,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub path: String,
    pub name: String,
    pub directory: bool,
    pub ignored: bool,
    pub status: String,
}
type Decorations<'a> = HashMap<&'a str, &'a str>;
fn directory_prefix(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    format!("{path}{}", git::PATH_SEPARATOR)
}
fn tree_entry(entry: DirEntry, prefix: &str) -> Result<Option<TreeEntry>> {
    if entry.file_name() == git::DOT_GIT {
        return Ok(None);
    }
    let name = entry
        .file_name()
        .into_string()
        .map_err(|_| Error::new("unsupported", "A filename is not valid UTF-8"))?;
    Ok(Some(TreeEntry {
        path: format!("{prefix}{name}"),
        name,
        directory: entry.file_type()?.is_dir(),
        ignored: false,
        status: String::new(),
    }))
}
fn read_entries(directory: &Path, prefix: &str) -> Result<Vec<TreeEntry>> {
    let mut entries = Vec::new();
    for result in std::fs::read_dir(directory)? {
        entries.extend(tree_entry(result?, prefix)?);
    }
    Ok(entries)
}
fn change_code(change: &Entry) -> &str {
    if change.worktree() != git::UNMODIFIED {
        return change.worktree();
    }
    change.index()
}
fn decorations<'a>(status: &'a Status, prefix: &str) -> Decorations<'a> {
    let mut decorations = HashMap::new();
    for change in &status.entries {
        let Some(relative) = change.path().strip_prefix(prefix) else {
            continue;
        };
        let name = relative
            .split(git::PATH_SEPARATOR)
            .next()
            .unwrap_or_default();
        decorations.entry(name).or_insert(change_code(change));
    }
    decorations
}
struct Marks<'a> {
    ignored: HashSet<String>,
    decorations: Decorations<'a>,
}
impl Marks<'_> {
    fn apply(&self, entry: &mut TreeEntry) {
        entry.ignored = self.ignored.contains(&entry.path);
        if entry.ignored {
            return;
        }
        if let Some(code) = self.decorations.get(entry.name.as_str()) {
            entry.status = (*code).into();
        }
    }
}
pub async fn list(repo: &Repo, path: &str) -> Result<Vec<TreeEntry>> {
    let directory = repo.path(path)?;
    let status = repo.snapshot().await?;
    repo.directory_reads.fetch_add(1, Ordering::SeqCst);
    let prefix = directory_prefix(path);
    let mut entries = read_entries(&directory, &prefix)?;
    if entries.is_empty() {
        return Ok(entries);
    }
    let marks = Marks {
        ignored: git::ignored(&repo.root, entries.iter().map(|entry| entry.path.as_str())).await?,
        decorations: decorations(&status, &prefix),
    };
    for entry in &mut entries {
        marks.apply(entry);
    }
    entries.sort_by_cached_key(|entry| (!entry.directory, entry.name.to_lowercase()));
    Ok(entries)
}
pub async fn files(repo: &Repo, ignored: bool) -> Result<Vec<String>> {
    let mut arguments = vec!["ls-files", "--cached", "--others", "-z"];
    if !ignored {
        arguments.push("--exclude-standard");
    }
    git::nul_list(&repo.root, &arguments).await
}
