use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
};
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

pub mod stack;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub kind: String,
    pub content: String,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub no_newline: bool,
    pub marks: Vec<Mark>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Mark {
    pub text: String,
    pub changed: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<Line>,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub path: String,
    pub source: String,
    pub old_mode: Option<String>,
    pub new_mode: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub hunks: Vec<Hunk>,
    pub content: Option<String>,
    pub added: bool,
    pub image: bool,
    pub old_size: usize,
    pub new_size: usize,
    pub old_dimensions: Option<Dimensions>,
    pub new_dimensions: Option<Dimensions>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Dimensions {
    pub width: u32,
    pub height: u32,
}
fn be16(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u16::from_be_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]).into())
}
fn le16(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u16::from_le_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]).into())
}
fn be32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}
fn le32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}
fn le24(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *bytes.get(at)?,
        *bytes.get(at + 1)?,
        *bytes.get(at + 2)?,
        0,
    ]))
}
fn jpeg_dimensions(bytes: &[u8]) -> Option<Dimensions> {
    let mut at = 2;
    while at + 1 < bytes.len() {
        if bytes[at] != 0xff {
            at += 1;
            continue;
        }
        let marker = bytes[at + 1];
        if matches!(marker, 0xff | 0x00 | 0x01 | 0xd0..=0xd9) {
            at += 2;
            continue;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            return Some(Dimensions {
                width: be16(bytes, at + 7)?,
                height: be16(bytes, at + 5)?,
            });
        }
        at += 2 + be16(bytes, at + 2)?.max(2) as usize;
    }
    None
}
fn webp_dimensions(bytes: &[u8]) -> Option<Dimensions> {
    match bytes.get(12..16)? {
        b"VP8X" => Some(Dimensions {
            width: le24(bytes, 24)? + 1,
            height: le24(bytes, 27)? + 1,
        }),
        b"VP8L" => {
            let packed = le32(bytes, 21)?;
            Some(Dimensions {
                width: (packed & 0x3fff) + 1,
                height: ((packed >> 14) & 0x3fff) + 1,
            })
        }
        b"VP8 " => Some(Dimensions {
            width: le16(bytes, 26)? & 0x3fff,
            height: le16(bytes, 28)? & 0x3fff,
        }),
        _ => None,
    }
}
pub fn dimensions(bytes: &[u8]) -> Option<Dimensions> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(Dimensions {
            width: be32(bytes, 16)?,
            height: be32(bytes, 20)?,
        });
    }
    if bytes.starts_with(b"GIF8") {
        return Some(Dimensions {
            width: le16(bytes, 6)?,
            height: le16(bytes, 8)?,
        });
    }
    if bytes.starts_with(b"BM") {
        return Some(Dimensions {
            width: (le32(bytes, 18)? as i32).unsigned_abs(),
            height: (le32(bytes, 22)? as i32).unsigned_abs(),
        });
    }
    if bytes.starts_with(b"\x00\x00\x01\x00") {
        let measure = |value: u8| if value == 0 { 256 } else { value.into() };
        return Some(Dimensions {
            width: measure(*bytes.get(6)?),
            height: measure(*bytes.get(7)?),
        });
    }
    if bytes.starts_with(b"\xff\xd8") {
        return jpeg_dimensions(bytes);
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return webp_dimensions(bytes);
    }
    None
}
fn range(value: &str) -> Result<(u32, u32)> {
    let mut parts = value.get(1..).unwrap_or_default().split(',');
    let start = parts
        .next()
        .unwrap_or_default()
        .parse()
        .map_err(|_| Error::new("unexpected", "Malformed diff range"))?;
    let count = parts
        .next()
        .unwrap_or("1")
        .parse()
        .map_err(|_| Error::new("unexpected", "Malformed diff count"))?;
    Ok((start, count))
}
pub fn parse(text: &str, path: &str, source: &str) -> Result<Diff> {
    let mut diff = Diff {
        path: path.into(),
        source: source.into(),
        ..Diff::default()
    };
    let mut old = 0;
    let mut new = 0;
    for value in text.split_terminator('\n') {
        if value.starts_with("@@ ") {
            let parts: Vec<&str> = value.split_whitespace().collect();
            if parts.len() < 4 {
                return Err(Error::new("unexpected", "Malformed hunk header"));
            }
            let (old_start, old_count) = range(parts[1])?;
            let (new_start, new_count) = range(parts[2])?;
            old = old_start;
            new = new_start;
            diff.hunks.push(Hunk {
                header: value.into(),
                old_start,
                old_count,
                new_start,
                new_count,
                lines: Vec::new(),
            });
        } else if let Some(hunk) = diff.hunks.last_mut() {
            if value == "\\ No newline at end of file" {
                if let Some(line) = hunk.lines.last_mut() {
                    line.no_newline = true;
                }
            } else if let Some(prefix) = value.chars().next() {
                let (kind, old_number, new_number) = match prefix {
                    '+' => {
                        let n = new;
                        new += 1;
                        ("add", None, Some(n))
                    }
                    '-' => {
                        let n = old;
                        old += 1;
                        ("remove", Some(n), None)
                    }
                    ' ' => {
                        let o = old;
                        let n = new;
                        old += 1;
                        new += 1;
                        ("context", Some(o), Some(n))
                    }
                    _ => continue,
                };
                hunk.lines.push(Line {
                    kind: kind.into(),
                    content: value[1..].into(),
                    old: old_number,
                    new: new_number,
                    no_newline: false,
                    marks: Vec::new(),
                });
            }
        } else if let Some(mode) = value
            .strip_prefix("old mode ")
            .or_else(|| value.strip_prefix("deleted file mode "))
        {
            diff.old_mode = Some(mode.into());
        } else if let Some(mode) = value
            .strip_prefix("new mode ")
            .or_else(|| value.strip_prefix("new file mode "))
        {
            diff.new_mode = Some(mode.into());
        } else if value.starts_with("Binary files ") || value == "GIT binary patch" {
            diff.binary = true;
        }
    }
    for hunk in &mut diff.hunks {
        mark_words(&mut hunk.lines);
    }
    Ok(diff)
}
pub fn mark_words(lines: &mut [Line]) {
    let mut position = 0;
    while position < lines.len() {
        if lines[position].kind != "remove" {
            position += 1;
            continue;
        }
        let start = position;
        while position < lines.len() && lines[position].kind == "remove" {
            position += 1;
        }
        let added = position;
        while position < lines.len() && lines[position].kind == "add" {
            position += 1;
        }
        for offset in 0..(added - start).min(position - added) {
            let old = lines[start + offset].content.clone();
            let new = lines[added + offset].content.clone();
            for change in TextDiff::from_words(&old, &new).iter_all_changes() {
                let mark = Mark {
                    text: change.value().into(),
                    changed: change.tag() != ChangeTag::Equal,
                };
                if change.tag() != ChangeTag::Insert {
                    lines[start + offset].marks.push(mark.clone());
                }
                if change.tag() != ChangeTag::Delete {
                    lines[added + offset].marks.push(mark);
                }
            }
        }
    }
}
pub async fn resolve(repo: &Repo, revision: &str) -> Result<String> {
    Ok(git::text(
        &repo.root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{revision}^{{commit}}"),
        ],
    )
    .await?
    .trim()
    .into())
}
#[derive(Debug, Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}
#[derive(Debug, Serialize)]
pub struct Comparison {
    pub base: String,
    pub target: String,
    pub files: Vec<ChangedFile>,
}
async fn tree_diff(repo: &Repo, listing: &str, base: &str, target: &str) -> Result<Vec<String>> {
    Ok(git::text(
        &repo.root,
        &[
            "diff-tree",
            "--no-commit-id",
            listing,
            "-r",
            "-z",
            base,
            target,
        ],
    )
    .await?
    .split('\0')
    .filter(|s| !s.is_empty())
    .map(String::from)
    .collect())
}
pub async fn compare(
    repo: &Repo,
    base: &str,
    target: &str,
    merge_base: bool,
) -> Result<Comparison> {
    let mut base = resolve(repo, base).await?;
    let target = resolve(repo, target).await?;
    if merge_base {
        let common = git::run(&repo.root, &["merge-base", &base, &target], None).await?;
        if common.code != 0 {
            return Err(Error::refused(
                "These branches have no common commit. Turn off \"Since branches diverged\" to compare them directly.",
            ));
        }
        base = common.text().trim().to_owned();
    }
    let statuses = tree_diff(repo, "--name-status", &base, &target).await?;
    let counts = tree_diff(repo, "--numstat", &base, &target).await?;
    let files = statuses
        .chunks(2)
        .zip(counts)
        .map(|(entry, count)| {
            let mut numbers = count.split('\t');
            let mut number = || numbers.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            ChangedFile {
                status: entry[0].chars().take(1).collect(),
                path: entry[1].clone(),
                additions: number(),
                deletions: number(),
            }
        })
        .collect();
    Ok(Comparison {
        base,
        target,
        files,
    })
}
enum Blob {
    Working(std::path::PathBuf),
    Object(String),
    Absent,
}
async fn location(
    repo: &Repo,
    path: &str,
    source: &str,
    revision: &str,
    base: &str,
    old: bool,
) -> Result<Blob> {
    let full = repo.path(path)?;
    if (source == "unstaged" || source == "file") && !old {
        return Ok(Blob::Working(full));
    }
    if source == "file" {
        return Ok(Blob::Absent);
    }
    if source == "stash"
        && crate::stash::untracked(repo, revision)
            .await?
            .iter()
            .any(|entry| entry == path)
    {
        if old {
            return Ok(Blob::Absent);
        }
        let sha = resolve(repo, revision).await?;
        return Ok(Blob::Object(format!("{sha}^3:{path}")));
    }
    let reference = match source {
        "staged" if old => "HEAD".into(),
        "staged" | "unstaged" => String::new(),
        "commit" | "stash" => {
            let sha = resolve(repo, revision).await?;
            if old {
                format!("{sha}^1")
            } else {
                sha
            }
        }
        "compare" if old => resolve(repo, base).await?,
        "compare" => resolve(repo, revision).await?,
        _ => return Err(Error::refused("Unknown diff source")),
    };
    let original = if old && source == "staged" {
        repo.status
            .entries
            .iter()
            .find(|e| e.path() == path)
            .and_then(|e| e.original_path())
            .unwrap_or(path)
    } else {
        path
    };
    let spec = format!("{reference}:{original}");
    let exists = git::run(&repo.root, &["cat-file", "-e", &spec], None).await?;
    if exists.code != 0 {
        if exists.stderr.contains("does not exist")
            || exists.stderr.contains("not in")
            || exists.stderr.contains("invalid object name")
            || exists.stderr.contains("Not a valid object name")
        {
            return Ok(Blob::Absent);
        }
        return Err(Error::git(exists.message()));
    }
    Ok(Blob::Object(spec))
}

pub async fn bytes(
    repo: &Repo,
    path: &str,
    source: &str,
    revision: &str,
    base: &str,
    old: bool,
) -> Result<Vec<u8>> {
    match location(repo, path, source, revision, base, old).await? {
        Blob::Absent => Ok(Vec::new()),
        Blob::Object(spec) => Ok(git::run(&repo.root, &["show", &spec], None)
            .await?
            .accept(&[0])?
            .bytes),
        Blob::Working(path) => match std::fs::read(path) {
            Ok(bytes) => Ok(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        },
    }
}
pub async fn size(
    repo: &Repo,
    path: &str,
    source: &str,
    revision: &str,
    base: &str,
    old: bool,
) -> Result<usize> {
    match location(repo, path, source, revision, base, old).await? {
        Blob::Absent => Ok(0),
        Blob::Object(spec) => git::text(&repo.root, &["cat-file", "-s", &spec])
            .await?
            .trim()
            .parse()
            .map_err(|_| Error::new("unexpected", "Invalid Git object size")),
        Blob::Working(path) => match std::fs::metadata(path) {
            Ok(metadata) => Ok(metadata.len() as usize),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
            Err(error) => Err(error.into()),
        },
    }
}
pub fn is_image(path: &str) -> bool {
    matches!(
        path.rsplit('.')
            .next()
            .unwrap_or_default()
            .to_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "svg" | "avif"
    )
}
const LINE_LIMIT: usize = 50000;
fn size_limit(image: bool) -> usize {
    if image {
        20 * 1024 * 1024
    } else {
        2 * 1024 * 1024
    }
}
fn missing_object(stderr: &str) -> bool {
    stderr.contains("does not exist")
        || stderr.contains("not in")
        || stderr.contains("invalid object name")
        || stderr.contains("Not a valid object name")
}
async fn object_sizes(repo: &Repo, specs: &[&str]) -> Result<Vec<Option<usize>>> {
    if specs.is_empty() {
        return Ok(Vec::new());
    }
    let input: String = specs.iter().map(|spec| format!("{spec}\0")).collect();
    let text = git::run(
        &repo.root,
        &["cat-file", "--batch-check", "-z"],
        Some(input.as_bytes()),
    )
    .await?
    .accept(&[0])?
    .text();
    let invalid = || Error::new("unexpected", "Invalid Git object size");
    let mut rest = text.as_str();
    specs
        .iter()
        .map(|spec| {
            if let Some((_, after)) = rest
                .strip_prefix(spec)
                .and_then(|after| after.strip_prefix(' '))
                .and_then(|after| after.split_once('\n'))
                .filter(|(word, _)| !word.contains(' '))
            {
                rest = after;
                return Ok(None);
            }
            let (line, after) = rest.split_once('\n').ok_or_else(invalid)?;
            rest = after;
            line.rsplit(' ')
                .next()
                .and_then(|size| size.parse().ok())
                .map(Some)
                .ok_or_else(invalid)
        })
        .collect()
}
enum Side {
    Working(std::path::PathBuf),
    Object(String),
    Absent,
}
async fn measure(repo: &Repo, side: &Side, size: Option<usize>) -> Result<usize> {
    match (side, size) {
        (Side::Absent, _) => Ok(0),
        (Side::Object(_), Some(size)) => Ok(size),
        (Side::Object(spec), None) => {
            let exists = git::run(&repo.root, &["cat-file", "-e", spec], None).await?;
            if exists.code == 0 {
                return git::text(&repo.root, &["cat-file", "-s", spec])
                    .await?
                    .trim()
                    .parse()
                    .map_err(|_| Error::new("unexpected", "Invalid Git object size"));
            }
            if missing_object(&exists.stderr) {
                return Ok(0);
            }
            Err(Error::git(exists.message()))
        }
        (Side::Working(path), _) => match std::fs::metadata(path) {
            Ok(metadata) => Ok(metadata.len() as usize),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
            Err(error) => Err(error.into()),
        },
    }
}
async fn side_bytes(repo: &Repo, side: &Side, size: usize) -> Result<Vec<u8>> {
    match side {
        Side::Object(_) if size == 0 => Ok(Vec::new()),
        Side::Absent => Ok(Vec::new()),
        Side::Object(spec) => Ok(git::run(&repo.root, &["show", spec], None)
            .await?
            .accept(&[0])?
            .bytes),
        Side::Working(path) => match std::fs::read(path) {
            Ok(bytes) => Ok(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        },
    }
}
pub async fn read(
    repo: &Repo,
    path: &str,
    source: &str,
    revision: &str,
    base: &str,
    context: u32,
    override_limit: bool,
) -> Result<Diff> {
    let full = repo.path(path)?;
    let image = is_image(path);
    let mut result = Diff {
        path: path.into(),
        source: source.into(),
        image,
        ..Diff::default()
    };
    let (parent, sha) = match source {
        "commit" | "stash" => {
            let sha = resolve(repo, revision).await?;
            (format!("{sha}^1"), sha)
        }
        "compare" => (resolve(repo, base).await?, resolve(repo, revision).await?),
        "staged" | "unstaged" | "file" => (String::new(), String::new()),
        _ => return Err(Error::refused("Unknown diff source")),
    };
    let untracked = source == "stash"
        && crate::stash::untracked(repo, &sha)
            .await?
            .iter()
            .any(|entry| entry == path);
    let original = repo
        .status
        .entries
        .iter()
        .find(|e| e.path() == path && source == "staged")
        .and_then(|e| e.original_path());
    let (old, new) = match source {
        "file" => (Side::Absent, Side::Working(full)),
        _ if untracked => (Side::Absent, Side::Object(format!("{sha}^3:{path}"))),
        "unstaged" => (Side::Object(format!(":{path}")), Side::Working(full)),
        "staged" => (
            Side::Object(format!("HEAD:{}", original.unwrap_or(path))),
            Side::Object(format!(":{path}")),
        ),
        _ => (
            Side::Object(format!("{parent}:{path}")),
            Side::Object(format!("{sha}:{path}")),
        ),
    };
    let rooted = matches!(source, "commit" | "stash") && !untracked;
    let mut specs = Vec::new();
    if rooted {
        specs.push(parent.as_str());
    }
    for side in [&old, &new] {
        if let Side::Object(spec) = side {
            specs.push(spec.as_str());
        }
    }
    let mut sizes = object_sizes(repo, &specs).await?.into_iter();
    let root = rooted && sizes.next().flatten().is_none();
    let old_size = match old {
        Side::Object(_) => sizes.next().flatten(),
        _ => None,
    };
    let new_size = match new {
        Side::Object(_) => sizes.next().flatten(),
        _ => None,
    };
    result.old_size = measure(repo, &old, old_size).await?;
    result.new_size = measure(repo, &new, new_size).await?;
    if (image || !override_limit) && result.old_size.max(result.new_size) > size_limit(image) {
        result.too_large = true;
        return Ok(result);
    }
    if image {
        result.old_dimensions = dimensions(&side_bytes(repo, &old, result.old_size).await?);
        result.new_dimensions = dimensions(&side_bytes(repo, &new, result.new_size).await?);
        return Ok(result);
    }
    if source == "file" || untracked {
        let new = side_bytes(repo, &new, result.new_size).await?;
        if new.contains(&0) {
            result.binary = true;
        } else {
            let content = String::from_utf8_lossy(&new);
            if !override_limit && content.lines().count() > LINE_LIMIT {
                result.too_large = true;
            } else {
                result.content = Some(content.into_owned());
                result.added = source == "stash"
                    || !git::text(
                        &repo.root,
                        &["ls-files", "--others", "--exclude-standard", "--", path],
                    )
                    .await?
                    .is_empty();
            }
        }
        return Ok(result);
    }
    let context = format!("--unified={}", context.min(50000));
    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        &context,
    ];
    if source == "staged" {
        args.push("--cached");
    } else if root {
        args = vec![
            "show",
            "--root",
            "--format=",
            "--no-ext-diff",
            "--no-textconv",
            &context,
            &sha,
        ];
    } else if source != "unstaged" {
        args.extend([parent.as_str(), sha.as_str()]);
    }
    args.extend(["--", path]);
    if let Some(original) = original {
        args.push(original);
    }
    let output = git::text(&repo.root, &args).await?;
    if !override_limit && output.lines().count() > LINE_LIMIT {
        result.too_large = true;
        return Ok(result);
    }
    let mut parsed = parse(&output, path, source)?;
    parsed.old_size = result.old_size;
    parsed.new_size = result.new_size;
    Ok(parsed)
}
pub fn patch(path: &str, hunk: &Hunk) -> Result<String> {
    if path.contains(['\n', '\r', '\0']) {
        return Err(Error::refused("Hunk actions are unavailable for paths containing control characters; use file staging"));
    }
    let quote = |prefix: &str| {
        format!(
            "\"{prefix}/{}\"",
            path.replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\t', "\\t")
        )
    };
    let a = quote("a");
    let b = quote("b");
    let mut patch = format!(
        "diff --git {a} {b}\n--- {a}\n+++ {b}\n@@ -{},{} +{},{} @@\n",
        hunk.old_start, hunk.old_count, hunk.new_start, hunk.new_count
    );
    for line in &hunk.lines {
        patch.push(match line.kind.as_str() {
            "add" => '+',
            "remove" => '-',
            _ => ' ',
        });
        patch.push_str(&line.content);
        patch.push('\n');
        if line.no_newline {
            patch.push_str("\\ No newline at end of file\n");
        }
    }
    Ok(patch)
}
pub async fn apply_hunk(
    repo: &mut Repo,
    path: &str,
    source: &str,
    hunk: usize,
    context: u32,
    expected: &str,
    action: &str,
) -> Result<()> {
    repo.writable().await?;
    if !matches!(
        (source, action),
        ("staged", "unstage") | ("unstaged", "stage") | ("unstaged", "discard")
    ) {
        return Err(Error::refused(
            "This action is not permitted for this diff source",
        ));
    }
    let diff = read(repo, path, source, "", "", context, true).await?;
    let hunk = diff
        .hunks
        .get(hunk)
        .ok_or_else(|| Error::refused("The hunk changed; select it again"))?;
    let patch = patch(path, hunk)?;
    if patch != expected {
        return Err(Error::refused(
            "The diff changed since it was shown; review it again",
        ));
    }
    let mut args = vec!["apply", "--whitespace=nowarn"];
    if action != "discard" {
        args.push("--cached");
    }
    if action != "stage" {
        args.push("--reverse");
    }
    let mut check = args.clone();
    check.push("--check");
    git::run(&repo.root, &check, Some(patch.as_bytes()))
        .await?
        .accept(&[0])?;
    git::run(&repo.root, &args, Some(patch.as_bytes()))
        .await?
        .accept(&[0])?;
    Ok(())
}
