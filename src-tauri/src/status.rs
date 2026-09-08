use crate::error::{Error, Result};
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
    },
    Renamed {
        path: String,
        original_path: String,
        score: String,
        index: String,
        worktree: String,
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
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub branch: String,
    pub oid: String,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub entries: Vec<Entry>,
    pub conflicted: bool,
}

pub fn parse(bytes: &[u8]) -> Result<Status> {
    let mut status = Status::default();
    let text = std::str::from_utf8(bytes)
        .map_err(|_| Error::new("unsupported", "A repository path is not valid UTF-8"))?;
    let mut records = text.split('\0').filter(|s| !s.is_empty());
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
                    .and_then(|v| v.trim_start_matches('+').parse().ok());
                status.behind = counts
                    .next()
                    .and_then(|v| v.trim_start_matches('-').parse().ok());
            }
            continue;
        }
        let kind = record.as_bytes()[0];
        if kind == b'?' {
            status.entries.push(Entry::Untracked {
                path: record[2..].into(),
                index: "?".into(),
                worktree: "?".into(),
            });
            continue;
        }
        let fields = match kind {
            b'1' => 9,
            b'2' => 10,
            b'u' => 11,
            _ => {
                return Err(Error::new(
                    "unexpected",
                    format!("Unknown status record: {record}"),
                ))
            }
        };
        let parts: Vec<&str> = record.splitn(fields, ' ').collect();
        if parts.len() != fields || parts[1].len() != 2 {
            return Err(Error::new("unexpected", "Malformed status record"));
        }
        let path: String = parts[fields - 1].into();
        let index: String = parts[1][..1].into();
        let worktree: String = parts[1][1..].into();
        status.entries.push(match kind {
            b'1' => Entry::Ordinary {
                path,
                index,
                worktree,
            },
            b'2' => Entry::Renamed {
                path,
                original_path: records
                    .next()
                    .ok_or_else(|| Error::new("unexpected", "Missing rename source"))?
                    .into(),
                score: parts[8].into(),
                index,
                worktree,
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
