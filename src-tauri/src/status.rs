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
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub entries: Vec<Entry>,
    pub conflicted: bool,
    #[serde(default)]
    pub merging: Option<String>,
    #[serde(default)]
    pub fetched: Option<String>,
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
fn record_fields(record: &str, count: usize) -> Result<Vec<&str>> {
    let parts: Vec<&str> = record.splitn(count, ' ').collect();
    if parts.len() != count || parts[1].len() != STATE_CODES {
        return Err(Error::unexpected("Malformed status record"));
    }
    Ok(parts)
}
fn path_field(parts: &[&str]) -> String {
    parts[parts.len() - 1].into()
}
fn index_state(parts: &[&str]) -> String {
    parts[1][..1].into()
}
fn worktree_state(parts: &[&str]) -> String {
    parts[1][1..].into()
}
fn untracked_entry(record: &str) -> Entry {
    Entry::Untracked {
        path: record[UNTRACKED_PATH_START..].into(),
        index: git::UNTRACKED.into(),
        worktree: git::UNTRACKED.into(),
    }
}
fn ordinary_entry(parts: &[&str]) -> Entry {
    Entry::Ordinary {
        path: path_field(parts),
        index: index_state(parts),
        worktree: worktree_state(parts),
        index_hash: parts[7].into(),
        index_mode: parts[4].into(),
    }
}
fn renamed_entry(parts: &[&str], original_path: Option<&str>) -> Result<Entry> {
    Ok(Entry::Renamed {
        path: path_field(parts),
        original_path: original_path
            .ok_or_else(|| Error::unexpected("Missing rename source"))?
            .into(),
        score: parts[8].into(),
        index: index_state(parts),
        worktree: worktree_state(parts),
        index_hash: parts[7].into(),
        index_mode: parts[4].into(),
    })
}
fn unmerged_entry(parts: &[&str]) -> Entry {
    Entry::Unmerged {
        path: path_field(parts),
        stage: parts[1].into(),
        modes: [
            parts[3].into(),
            parts[4].into(),
            parts[5].into(),
            parts[6].into(),
        ],
        hashes: [parts[7].into(), parts[8].into(), parts[9].into()],
        index: "C".into(),
        worktree: "C".into(),
    }
}
pub fn parse(bytes: &[u8]) -> Result<Status> {
    let mut status = Status::default();
    let text = std::str::from_utf8(bytes)
        .map_err(|_| Error::new("unsupported", "A repository path is not valid UTF-8"))?;
    let mut records = git::nul_fields(text);
    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix("# ") {
            if let Some(value) = header.strip_prefix("branch.head ") {
                status.branch = value.into();
            }
            if let Some(value) = header.strip_prefix("branch.oid ") {
                status.oid = value.into();
            }
            if let Some(value) = header.strip_prefix("branch.upstream ") {
                status.upstream = Some(value.into());
            }
            if let Some(value) = header.strip_prefix("branch.ab ") {
                let mut counts = value.split_whitespace();
                status.ahead = counts
                    .next()
                    .and_then(|count| count.trim_start_matches('+').parse().ok());
                status.behind = counts
                    .next()
                    .and_then(|count| count.trim_start_matches('-').parse().ok());
            }
            continue;
        }
        let entry = match RecordKind::of(record)? {
            RecordKind::Untracked => untracked_entry(record),
            RecordKind::Ordinary => ordinary_entry(&record_fields(record, ORDINARY_FIELDS)?),
            RecordKind::Renamed => {
                renamed_entry(&record_fields(record, RENAMED_FIELDS)?, records.next())?
            }
            RecordKind::Unmerged => {
                status.conflicted = true;
                unmerged_entry(&record_fields(record, UNMERGED_FIELDS)?)
            }
        };
        status.entries.push(entry);
    }
    Ok(status)
}
