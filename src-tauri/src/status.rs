use crate::{
    error::{Error, Result},
    git,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Entry {
    Untracked {
        path: String,
        index: String,
        worktree: String,
    },
    Ordinary {
        path: String,
        index: String,
        worktree: String,
        #[serde(skip)]
        index_hash: String,
        #[serde(skip)]
        index_mode: String,
    },
    Renamed {
        path: String,
        original_path: String,
        score: String,
        index: String,
        worktree: String,
        #[serde(skip)]
        index_hash: String,
        #[serde(skip)]
        index_mode: String,
    },
    Unmerged {
        path: String,
        stage: String,
        modes: [String; 4],
        hashes: [String; 3],
        index: String,
        worktree: String,
    },
}
impl Entry {
    pub fn path(&self) -> &str {
        match self {
            Entry::Untracked { path, .. }
            | Entry::Ordinary { path, .. }
            | Entry::Renamed { path, .. }
            | Entry::Unmerged { path, .. } => path,
        }
    }
    pub fn index(&self) -> &str {
        match self {
            Entry::Untracked { index, .. }
            | Entry::Ordinary { index, .. }
            | Entry::Renamed { index, .. }
            | Entry::Unmerged { index, .. } => index,
        }
    }
    pub fn worktree(&self) -> &str {
        match self {
            Entry::Untracked { worktree, .. }
            | Entry::Ordinary { worktree, .. }
            | Entry::Renamed { worktree, .. }
            | Entry::Unmerged { worktree, .. } => worktree,
        }
    }
    pub fn original_path(&self) -> Option<&str> {
        match self {
            Entry::Renamed { original_path, .. } => Some(original_path),
            _ => None,
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub branch: String,
    pub oid: String,
    pub upstream: Option<String>,
    #[serde(flatten)]
    pub divergence: Divergence,
    pub entries: Vec<Entry>,
    pub conflicted: bool,
    #[serde(default)]
    pub merging: Option<String>,
    #[serde(default)]
    pub fetched: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Divergence {
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
}
impl Divergence {
    fn parse(value: &str) -> Self {
        let mut counts = value.split_whitespace();
        let ahead = counts
            .next()
            .and_then(|count| count.trim_start_matches('+').parse().ok());
        let behind = counts
            .next()
            .and_then(|count| count.trim_start_matches('-').parse().ok());
        Self { ahead, behind }
    }
}

const UNTRACKED_PATH_START: usize = 2;
const ORDINARY_FIELDS: usize = 9;
const RENAMED_FIELDS: usize = 10;
const UNMERGED_FIELDS: usize = 11;
const STATE_CODES: usize = 2;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RecordKind {
    Untracked,
    Ordinary,
    Renamed,
    Unmerged,
}
impl RecordKind {
    fn of(record: &str) -> Result<Self> {
        match record.as_bytes()[0] {
            b'?' => Ok(Self::Untracked),
            b'1' => Ok(Self::Ordinary),
            b'2' => Ok(Self::Renamed),
            b'u' => Ok(Self::Unmerged),
            _ => Err(Error::unexpected(format!(
                "Unknown status record: {record}"
            ))),
        }
    }
}
fn malformed() -> Error {
    Error::unexpected("Malformed status record")
}
struct Fields<'a> {
    parts: std::str::SplitN<'a, char>,
}
impl<'a> Fields<'a> {
    fn of(record: &'a str, count: usize) -> Self {
        Self {
            parts: record.splitn(count, ' '),
        }
    }
    fn next(&mut self) -> Result<&'a str> {
        self.parts.next().ok_or_else(malformed)
    }
}
struct Header<'a> {
    state: &'a str,
}
impl Header<'_> {
    fn index(&self) -> String {
        self.state[..1].into()
    }
    fn worktree(&self) -> String {
        self.state[1..].into()
    }
}
fn parse_header<'a>(fields: &mut Fields<'a>) -> Result<Header<'a>> {
    let _kind = fields.next()?;
    let state = fields.next()?;
    let _submodule = fields.next()?;
    if state.len() != STATE_CODES {
        return Err(malformed());
    }
    Ok(Header { state })
}
struct Changed<'a> {
    header: Header<'a>,
    index_mode: &'a str,
    index_hash: &'a str,
}
fn parse_changed<'a>(fields: &mut Fields<'a>) -> Result<Changed<'a>> {
    let header = parse_header(fields)?;
    let _head_mode = fields.next()?;
    let index_mode = fields.next()?;
    let _worktree_mode = fields.next()?;
    let _head_hash = fields.next()?;
    let index_hash = fields.next()?;
    Ok(Changed {
        header,
        index_mode,
        index_hash,
    })
}
fn untracked_entry(record: &str) -> Entry {
    Entry::Untracked {
        path: record[UNTRACKED_PATH_START..].into(),
        index: git::UNTRACKED.into(),
        worktree: git::UNTRACKED.into(),
    }
}
fn ordinary_entry(record: &str) -> Result<Entry> {
    let mut fields = Fields::of(record, ORDINARY_FIELDS);
    let changed = parse_changed(&mut fields)?;
    let path = fields.next()?;
    Ok(Entry::Ordinary {
        path: path.into(),
        index: changed.header.index(),
        worktree: changed.header.worktree(),
        index_hash: changed.index_hash.into(),
        index_mode: changed.index_mode.into(),
    })
}
fn renamed_entry(record: &str, original_path: Option<&str>) -> Result<Entry> {
    let mut fields = Fields::of(record, RENAMED_FIELDS);
    let changed = parse_changed(&mut fields)?;
    let score = fields.next()?;
    let path = fields.next()?;
    Ok(Entry::Renamed {
        path: path.into(),
        original_path: original_path
            .ok_or_else(|| Error::unexpected("Missing rename source"))?
            .into(),
        score: score.into(),
        index: changed.header.index(),
        worktree: changed.header.worktree(),
        index_hash: changed.index_hash.into(),
        index_mode: changed.index_mode.into(),
    })
}
fn unmerged_entry(record: &str) -> Result<Entry> {
    let mut fields = Fields::of(record, UNMERGED_FIELDS);
    let header = parse_header(&mut fields)?;
    let first_mode = fields.next()?;
    let second_mode = fields.next()?;
    let third_mode = fields.next()?;
    let worktree_mode = fields.next()?;
    let first_hash = fields.next()?;
    let second_hash = fields.next()?;
    let third_hash = fields.next()?;
    let path = fields.next()?;
    Ok(Entry::Unmerged {
        path: path.into(),
        stage: header.state.into(),
        modes: [
            first_mode.into(),
            second_mode.into(),
            third_mode.into(),
            worktree_mode.into(),
        ],
        hashes: [first_hash.into(), second_hash.into(), third_hash.into()],
        index: "C".into(),
        worktree: "C".into(),
    })
}
pub fn parse(bytes: &[u8]) -> Result<Status> {
    let mut status = Status::default();
    let text = std::str::from_utf8(bytes)
        .map_err(|_| Error::new("unsupported", "A repository path is not valid UTF-8"))?;
    let mut records = git::nul_fields(text);
    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix(HEADER_PREFIX) {
            status.apply_header(header);
            continue;
        }
        let kind = RecordKind::of(record)?;
        if kind == RecordKind::Unmerged {
            status.conflicted = true;
        }
        let entry = match kind {
            RecordKind::Untracked => untracked_entry(record),
            RecordKind::Ordinary => ordinary_entry(record)?,
            RecordKind::Renamed => renamed_entry(record, records.next())?,
            RecordKind::Unmerged => unmerged_entry(record)?,
        };
        status.entries.push(entry);
    }
    Ok(status)
}
const HEADER_PREFIX: &str = "# ";
impl Status {
    fn apply_header(&mut self, header: &str) {
        if let Some(value) = header.strip_prefix("branch.head ") {
            self.branch = value.into();
            return;
        }
        if let Some(value) = header.strip_prefix("branch.oid ") {
            self.oid = value.into();
            return;
        }
        if let Some(value) = header.strip_prefix("branch.upstream ") {
            self.upstream = Some(value.into());
            return;
        }
        if let Some(value) = header.strip_prefix("branch.ab ") {
            self.divergence = Divergence::parse(value);
        }
    }
}
