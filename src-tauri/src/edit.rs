use crate::{diff, error::Result, repo::Repo};
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
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn open(bytes: Vec<u8>) -> Option<Opened> {
    if bytes.len() > diff::size_limit(false) || bytes.contains(&0) {
        return None;
    }
    let version = version(&bytes);
    let raw = String::from_utf8(bytes).ok()?;
    if raw.lines().count() > diff::LINE_LIMIT {
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

pub fn write(repo: &Repo, path: &str, content: &str, expected: Option<&str>) -> Result<Written> {
    let full = repo.path(path)?;
    let existing = current(&full)?;
    if existing.as_deref().map(version).as_deref() != expected {
        return Ok(Written::Conflict(existing.and_then(open)));
    }
    let shape = existing.and_then(open);
    let bom = shape.as_ref().is_some_and(|opened| opened.bom);
    let crlf = shape.as_ref().is_some_and(|opened| opened.crlf);
    let body = if crlf {
        content.replace('\n', "\r\n")
    } else {
        content.to_owned()
    };
    let bytes = if bom { format!("{BOM}{body}") } else { body }.into_bytes();
    std::fs::write(&full, &bytes)?;
    Ok(Written::Saved(version(&bytes)))
}
