use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::{Child, ChildStdout},
    task::JoinHandle,
};

pub const LINE_END: u8 = b'\n';
const OBJECT_HEADER_FIELDS: usize = 3;
const OBJECT_SIZE_FIELD: usize = 2;
const RAW_PREFIX: char = ':';
const RAW_FIELD_SEPARATOR: char = ' ';
const UNKNOWN_STATUS: char = '?';
const RENAMED: char = 'R';
const COPIED: char = 'C';
const OLD_MODE_FIELD: usize = 0;
const NEW_MODE_FIELD: usize = 1;
const OLD_OID_FIELD: usize = 2;
const NEW_OID_FIELD: usize = 3;

pub struct Stream {
    child: Child,
    reader: BufReader<ChildStdout>,
    writer: Option<JoinHandle<std::io::Result<()>>>,
    stderr: Option<JoinHandle<std::io::Result<Vec<u8>>>>,
}
fn object_size(header: &str) -> Option<usize> {
    let fields: Vec<&str> = header.split(' ').collect();
    if fields.len() != OBJECT_HEADER_FIELDS {
        return None;
    }
    fields.get(OBJECT_SIZE_FIELD)?.parse().ok()
}
impl Stream {
    pub fn start(repo: &Repo, arguments: &[&str], input: Vec<u8>) -> Result<Self> {
        let piped = git::spawn_piped(&mut git::command("git", &repo.root, arguments))?;
        Ok(Self {
            child: piped.child,
            reader: BufReader::new(piped.stdout),
            writer: Some(git::feed(piped.stdin, input)),
            stderr: Some(git::collect(piped.stderr)),
        })
    }
    pub async fn token(&mut self, delimiter: u8) -> Result<Option<Vec<u8>>> {
        let mut bytes = Vec::new();
        if self.reader.read_until(delimiter, &mut bytes).await? == 0 {
            return Ok(None);
        }
        if bytes.last() == Some(&delimiter) {
            bytes.pop();
        }
        Ok(Some(bytes))
    }
    pub async fn object(&mut self) -> Result<Option<Vec<u8>>> {
        let header = self
            .token(LINE_END)
            .await?
            .ok_or(Error::unexpected("Git object stream ended early"))?;
        let Some(size) = object_size(&String::from_utf8_lossy(&header)) else {
            return Ok(None);
        };
        let mut bytes = vec![0; size + 1];
        self.reader.read_exact(&mut bytes).await?;
        bytes.pop();
        Ok(Some(bytes))
    }
    async fn stderr_bytes(&mut self) -> Result<Vec<u8>> {
        let Some(task) = self.stderr.take() else {
            return Ok(Vec::new());
        };
        git::finish(task).await
    }
    pub async fn close(&mut self) -> Result<()> {
        let status = self.child.wait().await?;
        if let Some(writer) = self.writer.take() {
            let _ = writer.await;
        }
        let stderr = self.stderr_bytes().await?;
        if !status.success() {
            return Err(Error::git(
                String::from_utf8_lossy(&stderr).trim().to_owned(),
            ));
        }
        Ok(())
    }
}

pub struct Raw {
    pub combined: bool,
    pub status: char,
    pub old_mode: String,
    pub new_mode: String,
    pub old_oid: String,
    pub new_oid: String,
    pub old_path: String,
    pub path: String,
}
pub fn is_rename_status(status: char) -> bool {
    matches!(status, RENAMED | COPIED)
}
struct RawHead {
    combined: bool,
    status: char,
    old_mode: String,
    new_mode: String,
    old_oid: String,
    new_oid: String,
}
impl RawHead {
    fn parse(fields: &str) -> Self {
        let combined = fields.starts_with(RAW_PREFIX);
        let parts: Vec<&str> = fields
            .trim_start_matches(RAW_PREFIX)
            .split(RAW_FIELD_SEPARATOR)
            .collect();
        let status = parts
            .last()
            .and_then(|value| value.chars().next())
            .unwrap_or(UNKNOWN_STATUS);
        let recorded = recorded_fields(&parts, combined);
        let field = |index: usize| recorded.get(index).copied().unwrap_or_default().to_owned();
        Self {
            combined,
            status,
            old_mode: field(OLD_MODE_FIELD),
            new_mode: field(NEW_MODE_FIELD),
            old_oid: field(OLD_OID_FIELD),
            new_oid: field(NEW_OID_FIELD),
        }
    }
    fn has_two_paths(&self) -> bool {
        !self.combined && is_rename_status(self.status)
    }
}
fn recorded_fields<'a, 'parts>(parts: &'parts [&'a str], combined: bool) -> &'parts [&'a str] {
    if combined {
        return &[];
    }
    parts
}
async fn path_token(stream: &mut Stream) -> Result<String> {
    Ok(String::from_utf8_lossy(&stream.token(0).await?.unwrap_or_default()).into_owned())
}
async fn destination_path(stream: &mut Stream, head: &RawHead, first: &str) -> Result<String> {
    if !head.has_two_paths() {
        return Ok(first.to_owned());
    }
    path_token(stream).await
}
async fn raw_record(stream: &mut Stream, head: RawHead) -> Result<Raw> {
    let first = path_token(stream).await?;
    let path = destination_path(stream, &head, &first).await?;
    Ok(Raw {
        combined: head.combined,
        status: head.status,
        old_mode: head.old_mode,
        new_mode: head.new_mode,
        old_oid: head.old_oid,
        new_oid: head.new_oid,
        old_path: first,
        path,
    })
}
async fn raw(stream: &mut Stream) -> Result<Vec<Raw>> {
    let mut records = Vec::new();
    while let Some(token) = stream.token(0).await? {
        let head = String::from_utf8_lossy(&token).into_owned();
        let Some(fields) = head.strip_prefix(RAW_PREFIX) else {
            break;
        };
        records.push(raw_record(stream, RawHead::parse(fields)).await?);
    }
    Ok(records)
}
pub struct StackHandle {
    pub stream: Stream,
    pub records: Vec<Raw>,
}
pub async fn open(repo: &Repo, arguments: &[&str]) -> Result<StackHandle> {
    let mut stream = Stream::start(repo, arguments, Vec::new())?;
    let records = raw(&mut stream).await?;
    if records.is_empty() {
        stream.close().await?;
    }
    Ok(StackHandle { stream, records })
}
pub fn batch(repo: &Repo, oids: &[&str]) -> Result<Stream> {
    let input: String = oids.iter().map(|oid| format!("{oid}\n")).collect();
    Stream::start(repo, &["cat-file", "--batch"], input.into_bytes())
}
