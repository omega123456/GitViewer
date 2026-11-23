use super::{add_patches, dimensions, object::object_sizes, resolve, Diff, DiffSource, Dimensions};
use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
    status::Status,
};
use record::{Builder, Record, RecordContext};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
};
use stream::{batch, open, Stream, LINE_END};
use untracked::{
    add_stash_untracked, add_worktree_untracked, readable_entries, stash_listing, working_bytes,
    working_size, Collector,
};

mod record;
mod stream;
mod untracked;

const BUDGET: usize = 100_000;
const ZERO: &str = "0000000000000000000000000000000000000000";
const NO_RENAMES: &str = "--no-renames";
const STACK_FLAGS: [&str; 6] = [
    "--unified=3",
    "--submodule=short",
    "--raw",
    "-p",
    "-z",
    "--no-abbrev",
];
fn pinned(arguments: &mut Vec<&str>) {
    arguments.extend(git::PINNED_DIFF_FLAGS);
    arguments.extend(git::DIFF_PREFIXES);
    arguments.extend(STACK_FLAGS);
}

#[derive(Clone, Copy, Debug)]
pub struct StackRef<'a> {
    pub source: DiffSource,
    pub revision: &'a str,
    pub base: &'a str,
}

#[derive(Debug, Default, Serialize)]
pub struct Stack {
    pub files: BTreeMap<String, Diff>,
    pub truncated: bool,
}

#[derive(Default)]
struct Selection {
    range: Vec<String>,
    sha: String,
}
impl Selection {
    fn flags(flags: &[&str]) -> Self {
        Self {
            range: flags.iter().map(|flag| (*flag).to_owned()).collect(),
            sha: String::new(),
        }
    }
}
async fn revision_selection(repo: &Repo, revision: &str) -> Result<Selection> {
    let sha = resolve(repo, revision).await?;
    Ok(Selection {
        range: vec![NO_RENAMES.to_owned(), git::first_parent(&sha), sha.clone()],
        sha,
    })
}
async fn compare_selection(repo: &Repo, reference: StackRef<'_>) -> Result<Selection> {
    let from = resolve(repo, reference.base).await?;
    let to = resolve(repo, reference.revision).await?;
    Ok(Selection {
        range: vec![NO_RENAMES.to_owned(), from, to],
        sha: String::new(),
    })
}
async fn selection(repo: &Repo, reference: StackRef<'_>) -> Result<Selection> {
    match reference.source {
        DiffSource::Unstaged => Ok(Selection::flags(&[NO_RENAMES])),
        DiffSource::Staged => Ok(Selection::flags(&["--find-renames", "--cached"])),
        DiffSource::Commit | DiffSource::Stash => {
            revision_selection(repo, reference.revision).await
        }
        DiffSource::Compare => compare_selection(repo, reference).await,
        DiffSource::File => Err(Error::refused("Unknown diff source")),
    }
}
async fn status_for(repo: &Repo, source: DiffSource) -> Result<Arc<Status>> {
    if !source.is_uncommitted() {
        return Ok(Arc::default());
    }
    repo.snapshot().await
}
fn stack_command(source: DiffSource) -> &'static str {
    if source == DiffSource::Unstaged {
        return "diff-files";
    }
    "diff"
}
async fn open_root(repo: &Repo, sha: &str) -> Result<stream::StackHandle> {
    let mut root = vec!["show", "--root", git::EMPTY_FORMAT, NO_RENAMES];
    pinned(&mut root);
    root.push(sha);
    open(repo, &root).await
}
async fn open_stack(
    repo: &Repo,
    source: DiffSource,
    selection: &Selection,
) -> Result<stream::StackHandle> {
    let mut arguments = vec![stack_command(source)];
    pinned(&mut arguments);
    arguments.extend(selection.range.iter().map(String::as_str));
    match open(repo, &arguments).await {
        Err(_) if source.is_revision() => open_root(repo, &selection.sha).await,
        opened => opened,
    }
}

struct ObjectSizes(HashMap<String, usize>);
impl ObjectSizes {
    async fn of_records(repo: &Repo, records: &[Record]) -> Result<Self> {
        let oids: Vec<&str> = records
            .iter()
            .filter(|record| record.is_kept())
            .flat_map(|record| [record.raw.old_oid.as_str(), record.raw.new_oid.as_str()])
            .filter(|oid| *oid != ZERO)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let sizes = oids
            .iter()
            .zip(object_sizes(repo, &oids).await?)
            .map(|(oid, size)| (oid.to_string(), size.unwrap_or(0)))
            .collect();
        Ok(Self(sizes))
    }
    fn of(&self, oid: &str) -> usize {
        self.0.get(oid).copied().unwrap_or(0)
    }
}
fn new_side_size(record: &Record, source: DiffSource, sizes: &ObjectSizes) -> Option<usize> {
    if source == DiffSource::Unstaged {
        return record.full.as_deref().and_then(working_size);
    }
    Some(sizes.of(&record.raw.new_oid))
}
fn apply_size(record: &mut Record, source: DiffSource, sizes: &ObjectSizes) {
    let Some(new) = new_side_size(record, source, sizes) else {
        record.omit();
        return;
    };
    record.sized(sizes.of(&record.raw.old_oid), new);
}
async fn size_records(repo: &Repo, source: DiffSource, records: &mut [Record]) -> Result<()> {
    let sizes = ObjectSizes::of_records(repo, records).await?;
    for record in records.iter_mut().filter(|record| record.is_kept()) {
        apply_size(record, source, &sizes);
    }
    Ok(())
}

async fn stream_sections(stream: &mut Stream, builder: &mut Builder) -> Result<()> {
    while let Some(bytes) = stream.token(LINE_END).await? {
        builder.feed(&String::from_utf8_lossy(&bytes))?;
        if builder.over_budget() {
            builder.stack.truncated = true;
            return Ok(());
        }
    }
    Ok(())
}
async fn complete_sections(mut stream: Stream, builder: &mut Builder) -> Result<()> {
    if builder.stack.truncated {
        return Ok(());
    }
    builder.complete()?;
    stream.close().await
}

fn image_oids(builder: &Builder) -> Vec<&str> {
    let mut oids: Vec<&str> = Vec::new();
    for &index in &builder.images {
        let raw = &builder.records[index].raw;
        oids.push(&raw.old_oid);
        if builder.source != DiffSource::Unstaged {
            oids.push(&raw.new_oid);
        }
    }
    oids.retain(|oid| *oid != ZERO);
    oids.sort_unstable();
    oids.dedup();
    oids
}
type DecodedDimensions = HashMap<String, Option<Dimensions>>;
async fn decode_dimensions(repo: &Repo, oids: &[&str]) -> Result<DecodedDimensions> {
    let mut decoded = HashMap::new();
    if oids.is_empty() {
        return Ok(decoded);
    }
    let mut stream = batch(repo, oids)?;
    for oid in oids {
        let bytes = stream.object().await?.unwrap_or_default();
        decoded.insert(oid.to_string(), dimensions(&bytes));
    }
    stream.close().await?;
    Ok(decoded)
}
fn decoded_dimensions(decoded: &DecodedDimensions, oid: &str) -> Option<Dimensions> {
    decoded.get(oid).copied().flatten()
}
fn new_image_dimensions(
    record: &Record,
    source: DiffSource,
    decoded: &DecodedDimensions,
) -> Option<Dimensions> {
    if source != DiffSource::Unstaged {
        return decoded_dimensions(decoded, &record.raw.new_oid);
    }
    record
        .full
        .as_deref()
        .and_then(working_bytes)
        .and_then(|bytes| dimensions(&bytes))
}
async fn images(repo: &Repo, builder: &mut Builder) -> Result<()> {
    if builder.images.is_empty() {
        return Ok(());
    }
    let decoded = decode_dimensions(repo, &image_oids(builder)).await?;
    let source = builder.source;
    for &index in &builder.images {
        let record = &builder.records[index];
        let entry = Diff {
            old_dimensions: decoded_dimensions(&decoded, &record.raw.old_oid),
            new_dimensions: new_image_dimensions(record, source, &decoded),
            ..record.entry(source)
        };
        builder.stack.files.insert(entry.path.clone(), entry);
    }
    Ok(())
}

pub async fn read_patched(repo: &Repo, reference: StackRef<'_>) -> Result<Stack> {
    let mut stack = read(repo, reference).await?;
    stack.files.values_mut().for_each(add_patches);
    Ok(stack)
}
pub async fn read(repo: &Repo, reference: StackRef<'_>) -> Result<Stack> {
    let source = reference.source;
    let selection = selection(repo, reference).await?;
    let untracked = stash_listing(repo, source, &selection.sha).await?;
    let status = status_for(repo, source).await?;
    let handle = open_stack(repo, source, &selection).await?;
    let mut paths = repo.paths();
    let mut context = RecordContext {
        source,
        originals: status
            .entries
            .iter()
            .map(|entry| (entry.path(), entry.original_path()))
            .collect(),
        hidden: untracked.iter().map(|entry| entry.path.as_str()).collect(),
        paths: &mut paths,
    };
    let mut records: Vec<Record> = handle
        .records
        .into_iter()
        .map(|raw| context.record(raw))
        .collect();
    size_records(repo, source, &mut records).await?;
    let mut builder = Builder::new(source, records);
    let mut stream = handle.stream;
    stream_sections(&mut stream, &mut builder).await?;
    complete_sections(stream, &mut builder).await?;
    images(repo, &mut builder).await?;
    let mut collector = Collector::new(builder.stack, BUDGET - builder.used.min(BUDGET));
    if source == DiffSource::Unstaged {
        add_worktree_untracked(&mut collector, &status, &mut paths);
    }
    let readable = readable_entries(&untracked, &mut paths);
    add_stash_untracked(repo, &mut collector, readable).await?;
    Ok(collector.stack)
}
