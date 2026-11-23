use crate::{diff, error::Result, fs, repo::Repo};
use serde::Serialize;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;

const BOM: &str = "\u{feff}";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Opened {
    pub text: String,
    pub version: String,
    pub bom: bool,
    pub crlf: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Written {
    Saved(String),
    Conflict(Option<Opened>),
}

fn version(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn current(path: &Path) -> Result<Option<Vec<u8>>> {
    Ok(fs::read_optional(path)?)
}

fn open(bytes: Vec<u8>) -> Option<Opened> {
    let too_large = bytes.len() > diff::size_limit(false);
    if too_large || fs::is_binary(&bytes) {
        return None;
    }
    let version = version(&bytes);
    let raw = String::from_utf8(bytes).ok()?;
    if diff::over_line_limit(&raw) {
        return None;
    }
    let bom = raw.starts_with(BOM);
    let body = raw.strip_prefix(BOM).unwrap_or(&raw);
    let crlf = body.contains("\r\n");
    Some(Opened {
        text: body.replace("\r\n", "\n"),
        version,
        bom,
        crlf,
    })
}

pub fn read(repo: &Repo, path: &str) -> Result<Option<Opened>> {
    Ok(current(&repo.path(path)?)?.and_then(open))
}

pub struct Save<'a> {
    pub content: &'a str,
    pub expected: Option<&'a str>,
}

fn with_line_endings(content: &str, crlf: bool) -> String {
    if crlf {
        return content.replace('\n', "\r\n");
    }
    content.to_owned()
}
fn with_bom(body: String, bom: bool) -> String {
    if bom {
        return format!("{BOM}{body}");
    }
    body
}
pub fn write(repo: &Repo, path: &str, save: Save<'_>) -> Result<Written> {
    let Save { content, expected } = save;
    let full = repo.path(path)?;
    let existing = current(&full)?;
    let current_version = existing.as_deref().map(version);
    if current_version.as_deref() != expected {
        return Ok(Written::Conflict(existing.and_then(open)));
    }
    let shape = existing.and_then(open);
    let bom = shape.as_ref().is_some_and(|opened| opened.bom);
    let crlf = shape.as_ref().is_some_and(|opened| opened.crlf);
    let bytes = with_bom(with_line_endings(content, crlf), bom).into_bytes();
    std::fs::write(&full, &bytes)?;
    Ok(Written::Saved(version(&bytes)))
}
