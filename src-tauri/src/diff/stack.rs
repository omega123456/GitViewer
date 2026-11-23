use super::{
    add_patches, dimensions, object_sizes, parse, quote, resolve, size_limit, Diff, DiffSource,
    LINE_LIMIT,
};
use crate::{
    error::{Error, Result},
    fs, git,
    media::is_image,
    repo::Repo,
    status::Entry,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::{Child, ChildStdout},
    task::JoinHandle,
};

const BUDGET: usize = 100_000;
const ZERO: &str = "0000000000000000000000000000000000000000";
const OBJECT_HEADER_FIELDS: usize = 3;
const OBJECT_SIZE_FIELD: usize = 2;
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

struct Stream {
    child: Child,
    reader: BufReader<ChildStdout>,
    writer: Option<JoinHandle<std::io::Result<()>>>,
    stderr: Option<JoinHandle<std::io::Result<Vec<u8>>>>,
}
impl Stream {
    fn start(repo: &Repo, arguments: &[&str], input: Vec<u8>) -> Result<Self> {
        let piped = git::spawn_piped(&mut git::command("git", &repo.root, arguments))?;
        Ok(Self {
            child: piped.child,
            reader: BufReader::new(piped.stdout),
            writer: Some(git::feed(piped.stdin, input)),
            stderr: Some(git::collect(piped.stderr)),
        })
    }
    async fn token(&mut self, delimiter: u8) -> Result<Option<Vec<u8>>> {
        let mut bytes = Vec::new();
        if self.reader.read_until(delimiter, &mut bytes).await? == 0 {
            return Ok(None);
        }
        if bytes.last() == Some(&delimiter) {
            bytes.pop();
        }
        Ok(Some(bytes))
    }
    async fn object(&mut self) -> Result<Option<Vec<u8>>> {
        let header = self
            .token(b'\n')
            .await?
            .ok_or(Error::unexpected("Git object stream ended early"))?;
        let header = String::from_utf8_lossy(&header);
        let fields: Vec<&str> = header.split(' ').collect();
        let Some(size) = fields
            .get(OBJECT_SIZE_FIELD)
            .and_then(|size| size.parse::<usize>().ok())
            .filter(|_| fields.len() == OBJECT_HEADER_FIELDS)
        else {
            return Ok(None);
        };
        let mut bytes = vec![0; size + 1];
        self.reader.read_exact(&mut bytes).await?;
        bytes.pop();
        Ok(Some(bytes))
    }
    async fn close(&mut self) -> Result<()> {
        let status = self.child.wait().await?;
        if let Some(writer) = self.writer.take() {
            let _ = writer.await;
        }
        let stderr = match self.stderr.take() {
            Some(task) => git::finish(task).await?,
            None => Vec::new(),
        };
        if !status.success() {
            return Err(Error::git(
                String::from_utf8_lossy(&stderr).trim().to_owned(),
            ));
        }
        Ok(())
    }
}

struct Raw {
    combined: bool,
    status: char,
    old_mode: String,
    new_mode: String,
    old_oid: String,
    new_oid: String,
    old_path: String,
    path: String,
}
async fn raw(stream: &mut Stream) -> Result<Vec<Raw>> {
    let mut records = Vec::new();
    while let Some(token) = stream.token(0).await? {
        let head = String::from_utf8_lossy(&token).into_owned();
        let Some(fields) = head.strip_prefix(':') else {
            break;
        };
        let combined = fields.starts_with(':');
        let parts: Vec<&str> = fields.trim_start_matches(':').split(' ').collect();
        let status = parts
            .last()
            .and_then(|value| value.chars().next())
            .unwrap_or('?');
        let field = |index: usize| {
            if combined {
                String::new()
            } else {
                parts.get(index).copied().unwrap_or_default().to_owned()
            }
        };
        let first = path_token(stream).await?;
        let path = if !combined && matches!(status, 'R' | 'C') {
            path_token(stream).await?
        } else {
            first.clone()
        };
        records.push(Raw {
            combined,
            status,
            old_mode: field(0),
            new_mode: field(1),
            old_oid: field(2),
            new_oid: field(3),
            old_path: first,
            path,
        });
    }
    Ok(records)
}
async fn path_token(stream: &mut Stream) -> Result<String> {
    Ok(String::from_utf8_lossy(&stream.token(0).await?.unwrap_or_default()).into_owned())
}
struct StackHandle {
    stream: Stream,
    records: Vec<Raw>,
}
async fn open(repo: &Repo, arguments: &[&str]) -> Result<StackHandle> {
    let mut stream = Stream::start(repo, arguments, Vec::new())?;
    let records = raw(&mut stream).await?;
    if records.is_empty() {
        stream.close().await?;
    }
    Ok(StackHandle { stream, records })
}

fn controlled(path: &str) -> bool {
    path.chars().any(char::is_control)
}

#[derive(PartialEq)]
enum Kind {
    Omit,
    Large,
    Image,
    Text,
}
struct Record {
    raw: Raw,
    header: String,
    kind: Kind,
    full: Option<PathBuf>,
    old_size: usize,
    new_size: usize,
}
impl Record {
    fn omit(&mut self) {
        self.kind = Kind::Omit;
    }
    fn sized(&mut self, old_size: usize, new_size: usize) {
        self.old_size = old_size;
        self.new_size = new_size;
        let image = is_image(&self.raw.path);
        self.kind = if old_size.max(new_size) > size_limit(image) {
            Kind::Large
        } else if image {
            Kind::Image
        } else {
            Kind::Text
        };
    }
    fn entry(&self, source: DiffSource) -> Diff {
        Diff {
            image: is_image(&self.raw.path),
            old_size: self.old_size,
            new_size: self.new_size,
            ..Diff::empty(&self.raw.path, source)
        }
    }
}
#[derive(Default)]
struct Section {
    text: String,
    lines: usize,
    counted: usize,
    hunk: bool,
    over: bool,
}
impl Section {
    fn overflow(&mut self) {
        self.over = true;
        self.text = String::new();
    }
    fn count(&mut self, line: &str) {
        if line.starts_with("@@ ") {
            self.hunk = true;
            return;
        }
        if self.hunk && line.starts_with(['+', '-', ' ']) {
            self.counted += 1;
        }
    }
    fn push(&mut self, line: &str) {
        self.lines += 1;
        if self.over {
            return;
        }
        if self.lines > LINE_LIMIT {
            self.overflow();
            return;
        }
        self.count(line);
        self.text.push_str(line);
        self.text.push('\n');
    }
}

struct Builder {
    source: DiffSource,
    records: Vec<Record>,
    stack: Stack,
    images: Vec<usize>,
    used: usize,
}
struct OpenSection {
    index: usize,
    section: Section,
}
impl OpenSection {
    fn empty(index: usize) -> Self {
        Self {
            index,
            section: Section::default(),
        }
    }
}
impl Builder {
    fn finish(&mut self, open: OpenSection) -> Result<()> {
        let OpenSection { index, section } = open;
        let record = &self.records[index];
        match record.kind {
            Kind::Omit => {}
            Kind::Image => self.images.push(index),
            Kind::Text if !section.over => {
                let mut entry = parse(&section.text, &record.raw.path, self.source)?;
                entry.old_size = record.old_size;
                entry.new_size = record.new_size;
                self.stack.files.insert(entry.path.clone(), entry);
            }
            Kind::Large | Kind::Text => {
                let mut entry = record.entry(self.source);
                entry.too_large = true;
                self.stack.files.insert(entry.path.clone(), entry);
            }
        }
        self.used += section.counted;
        Ok(())
    }
    fn exceeds(&self, open: &OpenSection) -> bool {
        self.records[open.index].kind == Kind::Text && self.used + open.section.counted > BUDGET
    }
}

struct UntrackedEntry {
    path: String,
    oid: String,
    size: usize,
}
fn parse_tree_entry(entry: &str) -> Option<UntrackedEntry> {
    let (meta, path) = entry.split_once('\t')?;
    let mut fields = meta.split_whitespace();
    let _mode = fields.next()?;
    let kind = fields.next()?;
    let oid = fields.next()?;
    let size = fields.next()?;
    (kind == "blob").then(|| UntrackedEntry {
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
fn working_size(full: &Path) -> Option<usize> {
    fs::size_if_present(full).ok()
}
fn working_bytes(full: &Path) -> Option<Vec<u8>> {
    fs::read_if_present(full).ok()
}
struct Content<'a> {
    path: &'a str,
    source: DiffSource,
    size: usize,
}
struct SizedDiff {
    diff: Diff,
    cost: usize,
}
fn content(file: Content<'_>, bytes: Option<&[u8]>) -> SizedDiff {
    let mut entry = Diff {
        image: is_image(file.path),
        new_size: file.size,
        ..Diff::empty(file.path, file.source)
    };
    match bytes {
        None => entry.too_large = true,
        Some(bytes) if entry.image => entry.new_dimensions = dimensions(bytes),
        Some(bytes) if fs::is_binary(bytes) => entry.binary = true,
        Some(bytes) => {
            let text = String::from_utf8_lossy(bytes);
            let lines = fs::count_lines(&text);
            if lines > LINE_LIMIT {
                entry.too_large = true;
            } else {
                entry.content = Some(text.into_owned());
                entry.added = true;
                return SizedDiff {
                    diff: entry,
                    cost: lines,
                };
            }
        }
    }
    SizedDiff {
        diff: entry,
        cost: 0,
    }
}

pub async fn read_patched(repo: &Repo, reference: StackRef<'_>) -> Result<Stack> {
    let mut stack = read(repo, reference).await?;
    stack.files.values_mut().for_each(add_patches);
    Ok(stack)
}
pub async fn read(repo: &Repo, reference: StackRef<'_>) -> Result<Stack> {
    let StackRef {
        source,
        revision,
        base,
    } = reference;
    let mut range = Vec::new();
    let mut sha = String::new();
    match source {
        DiffSource::Unstaged => range.push("--no-renames".to_owned()),
        DiffSource::Staged => range.extend(["--find-renames".to_owned(), "--cached".to_owned()]),
        DiffSource::Commit | DiffSource::Stash => {
            sha = resolve(repo, revision).await?;
            range.extend([
                "--no-renames".to_owned(),
                git::first_parent(&sha),
                sha.clone(),
            ]);
        }
        DiffSource::Compare => {
            let from = resolve(repo, base).await?;
            let to = resolve(repo, revision).await?;
            range.extend(["--no-renames".to_owned(), from, to]);
        }
        DiffSource::File => return Err(Error::refused("Unknown diff source")),
    }
    let untracked = if source == DiffSource::Stash {
        listing(repo, &sha).await?
    } else {
        Vec::new()
    };
    let hidden: HashSet<&str> = untracked.iter().map(|entry| entry.path.as_str()).collect();
    let status = if source.is_uncommitted() {
        repo.snapshot().await?
    } else {
        Default::default()
    };
    let mut arguments = vec![if source == DiffSource::Unstaged {
        "diff-files"
    } else {
        "diff"
    }];
    pinned(&mut arguments);
    arguments.extend(range.iter().map(String::as_str));
    let StackHandle {
        mut stream,
        records: raws,
    } = match open(repo, &arguments).await {
        Err(_) if source.is_revision() => {
            let mut root = vec!["show", "--root", git::EMPTY_FORMAT, "--no-renames"];
            pinned(&mut root);
            root.push(&sha);
            open(repo, &root).await?
        }
        opened => opened?,
    };
    let originals: HashMap<&str, Option<&str>> = status
        .entries
        .iter()
        .map(|entry| (entry.path(), entry.original_path()))
        .collect();
    let mut paths = repo.paths();
    let mut records: Vec<Record> = raws
        .into_iter()
        .map(|raw| {
            let old_path = if matches!(raw.status, 'R' | 'C') {
                raw.old_path.as_str()
            } else {
                raw.path.as_str()
            };
            let header = quote::diff_header(
                &quote::quote_path(quote::OLD_PREFIX, old_path),
                &quote::quote_path(quote::NEW_PREFIX, &raw.path),
            );
            let paired = source != DiffSource::Staged || {
                let original = originals.get(raw.path.as_str()).copied().flatten();
                if matches!(raw.status, 'R' | 'C') {
                    original == Some(raw.old_path.as_str())
                } else {
                    original.is_none()
                }
            };
            let full = paths.resolve(&raw.path).ok();
            let omit = raw.combined
                || raw.status == 'U'
                || raw.old_mode == "160000"
                || raw.new_mode == "160000"
                || controlled(&raw.path)
                || controlled(&raw.old_path)
                || hidden.contains(raw.path.as_str())
                || !paired
                || full.is_none();
            Record {
                raw,
                header,
                kind: if omit { Kind::Omit } else { Kind::Text },
                full,
                old_size: 0,
                new_size: 0,
            }
        })
        .collect();
    let oids: Vec<&str> = records
        .iter()
        .filter(|record| record.kind != Kind::Omit)
        .flat_map(|record| [record.raw.old_oid.as_str(), record.raw.new_oid.as_str()])
        .filter(|oid| *oid != ZERO)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let sizes: HashMap<String, usize> = oids
        .iter()
        .zip(object_sizes(repo, &oids).await?)
        .map(|(oid, size)| (oid.to_string(), size.unwrap_or(0)))
        .collect();
    let size = |oid: &str| sizes.get(oid).copied().unwrap_or(0);
    for record in records
        .iter_mut()
        .filter(|record| record.kind != Kind::Omit)
    {
        let new = if source == DiffSource::Unstaged {
            record.full.as_deref().and_then(working_size)
        } else {
            Some(size(&record.raw.new_oid))
        };
        let Some(new) = new else {
            record.omit();
            continue;
        };
        record.sized(size(&record.raw.old_oid), new);
    }
    let mut builder = Builder {
        source,
        records,
        stack: Stack::default(),
        images: Vec::new(),
        used: 0,
    };
    let mut next = 0;
    let mut open_section: Option<OpenSection> = None;
    while let Some(bytes) = stream.token(b'\n').await? {
        let line = String::from_utf8_lossy(&bytes);
        if line.starts_with("diff --git ") {
            if open_section
                .as_ref()
                .is_none_or(|open| builder.records[open.index].header != line)
            {
                if let Some(open) = open_section.take() {
                    builder.finish(open)?;
                }
                if let Some(found) = (next..builder.records.len())
                    .find(|&index| builder.records[index].header == line)
                {
                    for index in next..found {
                        builder.finish(OpenSection::empty(index))?;
                    }
                    next = found + 1;
                    open_section = Some(OpenSection::empty(found));
                }
            }
        } else if line.starts_with("* ") {
            continue;
        }
        if let Some(open) = open_section.as_mut() {
            if builder.records[open.index].kind == Kind::Text {
                open.section.push(&line);
            }
            if builder.exceeds(open) {
                builder.stack.truncated = true;
                break;
            }
        }
    }
    if builder.stack.truncated {
        drop(stream);
    } else {
        if let Some(open) = open_section.take() {
            builder.finish(open)?;
        }
        for index in next..builder.records.len() {
            builder.finish(OpenSection::empty(index))?;
        }
        stream.close().await?;
    }
    images(repo, source, &mut builder).await?;
    let Builder {
        mut stack, used, ..
    } = builder;
    let mut budget = BUDGET - used.min(BUDGET);
    let mut add = |stack: &mut Stack, sized: SizedDiff| {
        if sized.cost > budget {
            stack.truncated = true;
            return false;
        }
        budget -= sized.cost;
        stack.files.insert(sized.diff.path.clone(), sized.diff);
        true
    };
    if source == DiffSource::Unstaged {
        for entry in &status.entries {
            let Entry::Untracked { path, .. } = entry else {
                continue;
            };
            let Some(full) = paths.resolve(path).ok().filter(|_| !controlled(path)) else {
                continue;
            };
            let Ok(kind) = std::fs::symlink_metadata(&full).map(|meta| meta.file_type()) else {
                continue;
            };
            if !(kind.is_file() || kind.is_symlink()) {
                continue;
            }
            let Some(size) = working_size(&full) else {
                continue;
            };
            let bytes = if size > size_limit(is_image(path)) {
                None
            } else {
                match working_bytes(&full) {
                    Some(bytes) => Some(bytes),
                    None => continue,
                }
            };
            let file = Content {
                path,
                source: DiffSource::File,
                size,
            };
            if !add(&mut stack, content(file, bytes.as_deref())) {
                break;
            }
        }
    }
    let readable: Vec<&UntrackedEntry> = untracked
        .iter()
        .filter(|entry| !controlled(&entry.path) && paths.resolve(&entry.path).is_ok())
        .collect();
    let wanted: Vec<&str> = readable
        .iter()
        .filter(|entry| entry.size <= size_limit(is_image(&entry.path)))
        .map(|entry| entry.oid.as_str())
        .collect();
    if !readable.is_empty() {
        let mut objects = (!wanted.is_empty())
            .then(|| batch(repo, &wanted))
            .transpose()?;
        for entry in readable {
            let bytes = match objects.as_mut() {
                Some(stream) if entry.size <= size_limit(is_image(&entry.path)) => {
                    match stream.object().await? {
                        Some(bytes) => Some(bytes),
                        None => continue,
                    }
                }
                _ => None,
            };
            let file = Content {
                path: &entry.path,
                source: DiffSource::Stash,
                size: entry.size,
            };
            if !add(&mut stack, content(file, bytes.as_deref())) {
                break;
            }
        }
    }
    Ok(stack)
}
fn batch(repo: &Repo, oids: &[&str]) -> Result<Stream> {
    let input: String = oids.iter().map(|oid| format!("{oid}\n")).collect();
    Stream::start(repo, &["cat-file", "--batch"], input.into_bytes())
}
async fn images(repo: &Repo, source: DiffSource, builder: &mut Builder) -> Result<()> {
    if builder.images.is_empty() {
        return Ok(());
    }
    let mut oids: Vec<&str> = Vec::new();
    for &index in &builder.images {
        let raw = &builder.records[index].raw;
        oids.push(&raw.old_oid);
        if source != DiffSource::Unstaged {
            oids.push(&raw.new_oid);
        }
    }
    oids.retain(|oid| *oid != ZERO);
    oids.sort_unstable();
    oids.dedup();
    let mut decoded = HashMap::new();
    if !oids.is_empty() {
        let mut stream = batch(repo, &oids)?;
        for oid in &oids {
            let bytes = stream.object().await?.unwrap_or_default();
            decoded.insert(oid.to_string(), dimensions(&bytes));
        }
        stream.close().await?;
    }
    let measure = |oid: &str| decoded.get(oid).copied().flatten();
    for &index in &builder.images {
        let record = &builder.records[index];
        let mut entry = record.entry(source);
        entry.old_dimensions = measure(&record.raw.old_oid);
        entry.new_dimensions = if source == DiffSource::Unstaged {
            record
                .full
                .as_deref()
                .and_then(working_bytes)
                .and_then(|bytes| dimensions(&bytes))
        } else {
            measure(&record.raw.new_oid)
        };
        builder.stack.files.insert(entry.path.clone(), entry);
    }
    Ok(())
}
