use super::{dimensions, is_image, object_sizes, parse, resolve, size_limit, Diff, LINE_LIMIT};
use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
    status::Entry,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::PathBuf,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdout},
    task::JoinHandle,
};

const BUDGET: usize = 100_000;
const ZERO: &str = "0000000000000000000000000000000000000000";
const PINNED: [&str; 11] = [
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--unified=3",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--submodule=short",
    "--raw",
    "-p",
    "-z",
    "--no-abbrev",
];

#[derive(Debug, Default, Serialize)]
pub struct Stack {
    pub files: BTreeMap<String, Diff>,
    pub truncated: bool,
}

struct Stream {
    child: Child,
    reader: BufReader<ChildStdout>,
    writer: Option<JoinHandle<std::io::Result<()>>>,
    stderr: Option<JoinHandle<std::io::Result<String>>>,
}
impl Stream {
    fn start(repo: &Repo, args: &[&str], input: Vec<u8>) -> Result<Self> {
        let mut child = git::command("git", &repo.root, args)
            .spawn()
            .map_err(|error| Error::new("missing_git", error.to_string()))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or(Error::new("unexpected", "Git stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or(Error::new("unexpected", "Git stdout unavailable"))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or(Error::new("unexpected", "Git stderr unavailable"))?;
        let writer = tokio::spawn(async move { stdin.write_all(&input).await });
        let stderr = tokio::spawn(async move {
            let mut text = String::new();
            stderr.read_to_string(&mut text).await?;
            Ok(text)
        });
        Ok(Self {
            child,
            reader: BufReader::new(stdout),
            writer: Some(writer),
            stderr: Some(stderr),
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
            .ok_or(Error::new("unexpected", "Git object stream ended early"))?;
        let header = String::from_utf8_lossy(&header);
        let fields: Vec<&str> = header.split(' ').collect();
        let Some(size) = fields
            .get(2)
            .and_then(|size| size.parse::<usize>().ok())
            .filter(|_| fields.len() == 3)
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
            Some(task) => task.await.map_err(Error::from)??,
            None => String::new(),
        };
        if !status.success() {
            return Err(Error::git(stderr.trim().to_owned()));
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
async fn open(repo: &Repo, args: &[&str]) -> Result<(Stream, Vec<Raw>)> {
    let mut stream = Stream::start(repo, args, Vec::new())?;
    let records = raw(&mut stream).await?;
    if records.is_empty() {
        stream.close().await?;
    }
    Ok((stream, records))
}

fn quoted(prefix: &str, path: &str) -> String {
    if !path
        .chars()
        .any(|c| c == '"' || c == '\\' || c.is_ascii_control())
    {
        return format!("{prefix}{path}");
    }
    let mut text = format!("\"{prefix}");
    for c in path.chars() {
        match c {
            '"' => text.push_str("\\\""),
            '\\' => text.push_str("\\\\"),
            '\x07' => text.push_str("\\a"),
            '\x08' => text.push_str("\\b"),
            '\t' => text.push_str("\\t"),
            '\n' => text.push_str("\\n"),
            '\x0b' => text.push_str("\\v"),
            '\x0c' => text.push_str("\\f"),
            '\r' => text.push_str("\\r"),
            c if c.is_ascii_control() => text.push_str(&format!("\\{:03o}", c as u32)),
            c => text.push(c),
        }
    }
    text.push('"');
    text
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
    fn entry(&self, source: &str) -> Diff {
        Diff {
            path: self.raw.path.clone(),
            source: source.into(),
            image: is_image(&self.raw.path),
            old_size: self.old_size,
            new_size: self.new_size,
            ..Diff::default()
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
    fn push(&mut self, line: &str) {
        self.lines += 1;
        if self.over {
            return;
        }
        if self.lines > LINE_LIMIT {
            self.over = true;
            self.text = String::new();
            return;
        }
        if line.starts_with("@@ ") {
            self.hunk = true;
        } else if self.hunk && line.starts_with(['+', '-', ' ']) {
            self.counted += 1;
        }
        self.text.push_str(line);
        self.text.push('\n');
    }
}

struct Builder<'a> {
    source: &'a str,
    records: Vec<Record>,
    stack: Stack,
    images: Vec<usize>,
    used: usize,
}
impl Builder<'_> {
    fn finish(&mut self, index: usize, section: Section) -> Result<()> {
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
    fn exceeds(&self, index: usize, section: &Section) -> bool {
        self.records[index].kind == Kind::Text && self.used + section.counted > BUDGET
    }
}

async fn listing(repo: &Repo, sha: &str) -> Result<Vec<(String, String, usize)>> {
    let output = git::run(
        &repo.root,
        &["ls-tree", "-r", "-l", "-z", &format!("{sha}^3")],
        None,
    )
    .await?;
    if output.code != 0 {
        return Ok(Vec::new());
    }
    Ok(output
        .text()
        .split('\0')
        .filter_map(|entry| {
            let (meta, path) = entry.split_once('\t')?;
            let fields: Vec<&str> = meta.split_whitespace().collect();
            (fields.get(1) == Some(&"blob")).then(|| {
                (
                    path.to_owned(),
                    fields[2].to_owned(),
                    fields[3].parse().unwrap_or(usize::MAX),
                )
            })
        })
        .collect())
}
fn working_size(full: &PathBuf) -> Option<usize> {
    match std::fs::metadata(full) {
        Ok(metadata) => Some(metadata.len() as usize),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(0),
        Err(_) => None,
    }
}
fn working_bytes(full: &PathBuf) -> Option<Vec<u8>> {
    match std::fs::read(full) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(Vec::new()),
        Err(_) => None,
    }
}
fn content(path: &str, source: &str, size: usize, bytes: Option<&[u8]>) -> (Diff, usize) {
    let mut entry = Diff {
        path: path.into(),
        source: source.into(),
        image: is_image(path),
        new_size: size,
        ..Diff::default()
    };
    match bytes {
        None => entry.too_large = true,
        Some(bytes) if entry.image => entry.new_dimensions = dimensions(bytes),
        Some(bytes) if bytes.contains(&0) => entry.binary = true,
        Some(bytes) => {
            let text = String::from_utf8_lossy(bytes);
            let lines = text.lines().count();
            if lines > LINE_LIMIT {
                entry.too_large = true;
            } else {
                entry.content = Some(text.into_owned());
                entry.added = true;
                return (entry, lines);
            }
        }
    }
    (entry, 0)
}

pub async fn read(repo: &Repo, source: &str, revision: &str, base: &str) -> Result<Stack> {
    let mut range = Vec::new();
    let mut sha = String::new();
    match source {
        "unstaged" => range.push("--no-renames".to_owned()),
        "staged" => range.extend(["--find-renames".to_owned(), "--cached".to_owned()]),
        "commit" | "stash" => {
            sha = resolve(repo, revision).await?;
            range.extend(["--no-renames".to_owned(), format!("{sha}^1"), sha.clone()]);
        }
        "compare" => {
            let from = resolve(repo, base).await?;
            let to = resolve(repo, revision).await?;
            range.extend(["--no-renames".to_owned(), from, to]);
        }
        _ => return Err(Error::refused("Unknown diff source")),
    }
    let untracked = if source == "stash" {
        listing(repo, &sha).await?
    } else {
        Vec::new()
    };
    let hidden: HashSet<&str> = untracked.iter().map(|(path, ..)| path.as_str()).collect();
    let mut args = vec!["diff"];
    args.extend(PINNED);
    args.extend(range.iter().map(String::as_str));
    let (mut stream, raws) = match open(repo, &args).await {
        Err(_) if matches!(source, "commit" | "stash") => {
            let mut root = vec!["show", "--root", "--format=", "--no-renames"];
            root.extend(PINNED);
            root.push(&sha);
            open(repo, &root).await?
        }
        opened => opened?,
    };
    let mut records: Vec<Record> = raws
        .into_iter()
        .map(|raw| {
            let old_path = if matches!(raw.status, 'R' | 'C') {
                raw.old_path.as_str()
            } else {
                raw.path.as_str()
            };
            let header = format!(
                "diff --git {} {}",
                quoted("a/", old_path),
                quoted("b/", &raw.path)
            );
            let paired = source != "staged" || {
                let original = repo
                    .status
                    .entries
                    .iter()
                    .find(|entry| entry.path() == raw.path)
                    .and_then(Entry::original_path);
                if matches!(raw.status, 'R' | 'C') {
                    original == Some(raw.old_path.as_str())
                } else {
                    original.is_none()
                }
            };
            let full = repo.path(&raw.path).ok();
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
        record.old_size = size(&record.raw.old_oid);
        let new = if source == "unstaged" {
            record.full.as_ref().and_then(working_size)
        } else {
            Some(size(&record.raw.new_oid))
        };
        let Some(new) = new else {
            record.kind = Kind::Omit;
            continue;
        };
        record.new_size = new;
        let image = is_image(&record.raw.path);
        record.kind = if record.old_size.max(new) > size_limit(image) {
            Kind::Large
        } else if image {
            Kind::Image
        } else {
            Kind::Text
        };
    }
    let mut builder = Builder {
        source,
        records,
        stack: Stack::default(),
        images: Vec::new(),
        used: 0,
    };
    let mut next = 0;
    let mut open: Option<(usize, Section)> = None;
    while let Some(bytes) = stream.token(b'\n').await? {
        let line = String::from_utf8_lossy(&bytes);
        if line.starts_with("diff --git ") {
            if open
                .as_ref()
                .is_none_or(|(index, _)| builder.records[*index].header != line)
            {
                if let Some((index, section)) = open.take() {
                    builder.finish(index, section)?;
                }
                if let Some(found) = (next..builder.records.len())
                    .find(|&index| builder.records[index].header == line)
                {
                    for index in next..found {
                        builder.finish(index, Section::default())?;
                    }
                    next = found + 1;
                    open = Some((found, Section::default()));
                }
            }
        } else if line.starts_with("* ") {
            continue;
        }
        if let Some((index, section)) = open.as_mut() {
            if builder.records[*index].kind == Kind::Text {
                section.push(&line);
            }
            if builder.exceeds(*index, section) {
                builder.stack.truncated = true;
                break;
            }
        }
    }
    if builder.stack.truncated {
        drop(stream);
    } else {
        if let Some((index, section)) = open.take() {
            builder.finish(index, section)?;
        }
        for index in next..builder.records.len() {
            builder.finish(index, Section::default())?;
        }
        stream.close().await?;
    }
    images(repo, source, &mut builder).await?;
    let Builder {
        mut stack, used, ..
    } = builder;
    let mut budget = BUDGET - used.min(BUDGET);
    let mut add = |stack: &mut Stack, entry: Diff, cost: usize| {
        if cost > budget {
            stack.truncated = true;
            return false;
        }
        budget -= cost;
        stack.files.insert(entry.path.clone(), entry);
        true
    };
    if source == "unstaged" {
        for entry in &repo.status.entries {
            let Entry::Untracked { path, .. } = entry else {
                continue;
            };
            let Some(full) = repo.path(path).ok().filter(|_| !controlled(path)) else {
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
            let (entry, cost) = content(path, "file", size, bytes.as_deref());
            if !add(&mut stack, entry, cost) {
                break;
            }
        }
    }
    let readable: Vec<&(String, String, usize)> = untracked
        .iter()
        .filter(|(path, ..)| !controlled(path) && repo.path(path).is_ok())
        .collect();
    let wanted: Vec<&str> = readable
        .iter()
        .filter(|(path, _, size)| *size <= size_limit(is_image(path)))
        .map(|(_, oid, _)| oid.as_str())
        .collect();
    if !readable.is_empty() {
        let mut batch = (!wanted.is_empty())
            .then(|| batch(repo, &wanted))
            .transpose()?;
        for (path, _, size) in readable {
            let bytes = match batch.as_mut() {
                Some(batch) if *size <= size_limit(is_image(path)) => match batch.object().await? {
                    Some(bytes) => Some(bytes),
                    None => continue,
                },
                _ => None,
            };
            let (entry, cost) = content(path, "stash", *size, bytes.as_deref());
            if !add(&mut stack, entry, cost) {
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
async fn images(repo: &Repo, source: &str, builder: &mut Builder<'_>) -> Result<()> {
    if builder.images.is_empty() {
        return Ok(());
    }
    let mut oids: Vec<&str> = Vec::new();
    for &index in &builder.images {
        let raw = &builder.records[index].raw;
        oids.push(&raw.old_oid);
        if source != "unstaged" {
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
        entry.new_dimensions = if source == "unstaged" {
            record
                .full
                .as_ref()
                .and_then(working_bytes)
                .and_then(|bytes| dimensions(&bytes))
        } else {
            measure(&record.raw.new_oid)
        };
        builder.stack.files.insert(entry.path.clone(), entry);
    }
    Ok(())
}
