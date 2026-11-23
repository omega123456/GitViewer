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
        let kind = record.as_bytes()[0];
        if kind == b'?' {
            status.entries.push(Entry::Untracked {
                path: record[UNTRACKED_PATH_START..].into(),
                index: git::UNTRACKED.into(),
                worktree: git::UNTRACKED.into(),
            });
            continue;
        }
        let fields = match kind {
            b'1' => ORDINARY_FIELDS,
            b'2' => RENAMED_FIELDS,
            b'u' => UNMERGED_FIELDS,
            _ => {
                return Err(Error::unexpected(format!(
                    "Unknown status record: {record}"
                )))
            }
        };
        let parts: Vec<&str> = record.splitn(fields, ' ').collect();
        if parts.len() != fields || parts[1].len() != STATE_CODES {
            return Err(Error::unexpected("Malformed status record"));
        }
        let path: String = parts[fields - 1].into();
        let index: String = parts[1][..1].into();
        let worktree: String = parts[1][1..].into();
        status.entries.push(match kind {
            b'1' => Entry::Ordinary {
                path,
                index,
                worktree,
                index_hash: parts[7].into(),
                index_mode: parts[4].into(),
            },
            b'2' => Entry::Renamed {
                path,
                original_path: records
                    .next()
                    .ok_or_else(|| Error::unexpected("Missing rename source"))?
                    .into(),
                score: parts[8].into(),
                index,
                worktree,
                index_hash: parts[7].into(),
                index_mode: parts[4].into(),
            },
            _ => {
                status.conflicted = true;
                Entry::Unmerged {
                    path,
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
        });
    }
    Ok(status)
}
