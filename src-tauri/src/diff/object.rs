use super::{DiffRef, DiffSource, Side};
use crate::{
    error::{Error, Result},
    fs, git,
    repo::Repo,
};
use std::path::PathBuf;

pub const LINE_LIMIT: usize = 50000;
pub const BYTES_PER_MEGABYTE: usize = 1024 * 1024;
pub const BLOB_SIZE_LIMIT: usize = 20 * BYTES_PER_MEGABYTE;
const TEXT_SIZE_LIMIT: usize = 2 * BYTES_PER_MEGABYTE;
const MISSING_OBJECT_MESSAGES: [&str; 4] = [
    "does not exist",
    "not in",
    "invalid object name",
    "Not a valid object name",
];
const BATCH_FIELD_SEPARATOR: char = ' ';
const BATCH_LINE_END: char = '\n';

pub enum Blob {
    Working(PathBuf),
    Object(String),
    Absent,
}
impl Blob {
    pub fn object_spec(&self) -> Option<&str> {
        let Self::Object(spec) = self else {
            return None;
        };
        Some(spec)
    }
}

pub async fn resolve(repo: &Repo, revision: &str) -> Result<String> {
    Ok(git::text(
        &repo.root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &git::commit_of(revision),
        ],
    )
    .await?
    .trim()
    .into())
}
pub fn over_line_limit(text: &str) -> bool {
    fs::count_lines(text) > LINE_LIMIT
}
pub fn size_limit(image: bool) -> usize {
    if image {
        return BLOB_SIZE_LIMIT;
    }
    TEXT_SIZE_LIMIT
}
fn missing_object(stderr: &str) -> bool {
    MISSING_OBJECT_MESSAGES
        .iter()
        .any(|message| stderr.contains(message))
}
async fn object_present(repo: &Repo, spec: &str) -> Result<bool> {
    let exists = git::run(&repo.root, &["cat-file", "-e", spec], None).await?;
    if exists.succeeded() {
        return Ok(true);
    }
    if missing_object(&exists.stderr) {
        return Ok(false);
    }
    Err(Error::git(exists.message()))
}
async fn renamed_from(repo: &Repo, path: &str) -> Result<Option<String>> {
    Ok(repo
        .snapshot()
        .await?
        .entries
        .iter()
        .find(|entry| entry.path() == path)
        .and_then(|entry| entry.original_path())
        .map(String::from))
}
pub async fn original_path(
    repo: &Repo,
    reference: DiffRef<'_>,
    side: Side,
) -> Result<Option<String>> {
    let staged_old_side = side == Side::Old && reference.source == DiffSource::Staged;
    if !staged_old_side {
        return Ok(None);
    }
    renamed_from(repo, reference.path).await
}
pub async fn stash_has_untracked(repo: &Repo, stash: &str, path: &str) -> Result<bool> {
    Ok(crate::stash::untracked(repo, stash)
        .await?
        .iter()
        .any(|entry| entry == path))
}
async fn untracked_in_stash_reference(repo: &Repo, reference: DiffRef<'_>) -> Result<bool> {
    if reference.source != DiffSource::Stash {
        return Ok(false);
    }
    stash_has_untracked(repo, reference.revision, reference.path).await
}
async fn untracked_stash_blob(repo: &Repo, reference: DiffRef<'_>, side: Side) -> Result<Blob> {
    if side == Side::Old {
        return Ok(Blob::Absent);
    }
    let sha = resolve(repo, reference.revision).await?;
    Ok(Blob::Object(git::object_at(
        &git::stash_untracked(&sha),
        reference.path,
    )))
}
fn revision_side(sha: String, side: Side) -> String {
    if side == Side::Old {
        return git::first_parent(&sha);
    }
    sha
}
async fn side_revision(repo: &Repo, reference: DiffRef<'_>, side: Side) -> Result<Option<String>> {
    let old = side == Side::Old;
    let revision = match reference.source {
        DiffSource::File => return Ok(None),
        DiffSource::Staged if old => git::HEAD.into(),
        DiffSource::Staged | DiffSource::Unstaged => String::new(),
        DiffSource::Commit | DiffSource::Stash => {
            revision_side(resolve(repo, reference.revision).await?, side)
        }
        DiffSource::Compare if old => resolve(repo, reference.base).await?,
        DiffSource::Compare => resolve(repo, reference.revision).await?,
    };
    Ok(Some(revision))
}
fn reads_working_tree(source: DiffSource, side: Side) -> bool {
    let working_source = matches!(source, DiffSource::Unstaged | DiffSource::File);
    working_source && side == Side::New
}
async fn location(repo: &Repo, reference: DiffRef<'_>, side: Side) -> Result<Blob> {
    let full = repo.path(reference.path)?;
    if reads_working_tree(reference.source, side) {
        return Ok(Blob::Working(full));
    }
    if untracked_in_stash_reference(repo, reference).await? {
        return untracked_stash_blob(repo, reference, side).await;
    }
    let Some(revision) = side_revision(repo, reference, side).await? else {
        return Ok(Blob::Absent);
    };
    let original = original_path(repo, reference, side).await?;
    let spec = git::object_at(&revision, original.as_deref().unwrap_or(reference.path));
    if object_present(repo, &spec).await? {
        return Ok(Blob::Object(spec));
    }
    Ok(Blob::Absent)
}
async fn object_bytes(repo: &Repo, spec: &str) -> Result<Vec<u8>> {
    Ok(git::run(&repo.root, &["show", spec], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?
        .bytes)
}
async fn object_size(repo: &Repo, spec: &str) -> Result<usize> {
    git::text(&repo.root, &["cat-file", "-s", spec])
        .await?
        .trim()
        .parse()
        .map_err(|_| Error::unexpected("Invalid Git object size"))
}
pub async fn blob_bytes(repo: &Repo, blob: &Blob) -> Result<Vec<u8>> {
    match blob {
        Blob::Absent => Ok(Vec::new()),
        Blob::Object(spec) => object_bytes(repo, spec).await,
        Blob::Working(path) => Ok(fs::read_if_present(path)?),
    }
}
pub async fn bytes(repo: &Repo, reference: DiffRef<'_>, side: Side) -> Result<Vec<u8>> {
    blob_bytes(repo, &location(repo, reference, side).await?).await
}
pub async fn size(repo: &Repo, reference: DiffRef<'_>, side: Side) -> Result<usize> {
    match location(repo, reference, side).await? {
        Blob::Absent => Ok(0),
        Blob::Object(spec) => object_size(repo, &spec).await,
        Blob::Working(path) => Ok(fs::size_if_present(&path)?),
    }
}
pub async fn text(repo: &Repo, reference: DiffRef<'_>, side: Side) -> Result<Option<String>> {
    if size(repo, reference, side).await? > size_limit(false) {
        return Ok(None);
    }
    let bytes = bytes(repo, reference, side).await?;
    if fs::is_binary(&bytes) {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&bytes);
    if over_line_limit(&text) {
        return Ok(None);
    }
    Ok(Some(text.into_owned()))
}

struct BatchEntry<'a> {
    size: Option<usize>,
    rest: &'a str,
}
fn missing_batch_entry<'a>(rest: &'a str, spec: &str) -> Option<&'a str> {
    let (word, after) = rest
        .strip_prefix(spec)?
        .strip_prefix(BATCH_FIELD_SEPARATOR)?
        .split_once(BATCH_LINE_END)?;
    let single_word = !word.contains(BATCH_FIELD_SEPARATOR);
    single_word.then_some(after)
}
fn next_batch_entry<'a>(rest: &'a str, spec: &str) -> Result<BatchEntry<'a>> {
    if let Some(after) = missing_batch_entry(rest, spec) {
        return Ok(BatchEntry {
            size: None,
            rest: after,
        });
    }
    let invalid = || Error::unexpected("Invalid Git object size");
    let (line, after) = rest.split_once(BATCH_LINE_END).ok_or_else(invalid)?;
    let size = line
        .rsplit(BATCH_FIELD_SEPARATOR)
        .next()
        .and_then(|size| size.parse().ok())
        .ok_or_else(invalid)?;
    Ok(BatchEntry {
        size: Some(size),
        rest: after,
    })
}
fn batch_sizes(text: &str, specs: &[&str]) -> Result<Vec<Option<usize>>> {
    let mut rest = text;
    let mut sizes = Vec::with_capacity(specs.len());
    for spec in specs {
        let entry = next_batch_entry(rest, spec)?;
        rest = entry.rest;
        sizes.push(entry.size);
    }
    Ok(sizes)
}
pub async fn object_sizes(repo: &Repo, specs: &[&str]) -> Result<Vec<Option<usize>>> {
    if specs.is_empty() {
        return Ok(Vec::new());
    }
    let input: String = specs
        .iter()
        .map(|spec| format!("{spec}{}", git::NUL))
        .collect();
    let text = git::run(
        &repo.root,
        &["cat-file", "--batch-check", "-z"],
        Some(input.as_bytes()),
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?
    .text();
    batch_sizes(&text, specs)
}
async fn unsized_object(repo: &Repo, spec: &str) -> Result<usize> {
    if !object_present(repo, spec).await? {
        return Ok(0);
    }
    object_size(repo, spec).await
}
pub async fn measure(repo: &Repo, side: &Blob, size: Option<usize>) -> Result<usize> {
    match (side, size) {
        (Blob::Absent, _) => Ok(0),
        (Blob::Object(_), Some(size)) => Ok(size),
        (Blob::Object(spec), None) => unsized_object(repo, spec).await,
        (Blob::Working(path), _) => Ok(fs::size_if_present(path)?),
    }
}
pub async fn side_bytes(repo: &Repo, side: &Blob, size: usize) -> Result<Vec<u8>> {
    match side {
        Blob::Object(_) if size == 0 => Ok(Vec::new()),
        _ => blob_bytes(repo, side).await,
    }
}
