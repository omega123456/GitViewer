use crate::{
    error::{Error, Result},
    fs, git,
    media::is_image,
    repo::Repo,
};
use serde::{Deserialize, Serialize};
use similar::{ChangeTag, DiffTag, TextDiff};
use std::ops::Range;

pub mod quote;
pub mod stack;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub kind: String,
    pub content: String,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub no_newline: bool,
    pub marks: Vec<[u32; 2]>,
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
    #[serde(default)]
    pub patches: Vec<String>,
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
pub const DIFF_CONTEXT_LINES: u32 = 3;
const MAX_CONTEXT_LINES: u32 = 50_000;
const HUNK_HEADER_PARTS: usize = 4;
const NAME_STATUS_FIELDS: usize = 2;
const WORD_BYTES: usize = std::mem::size_of::<u32>();
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const PNG_WIDTH_OFFSET: usize = 16;
const PNG_HEIGHT_OFFSET: usize = 20;
const GIF_SIGNATURE: &[u8] = b"GIF8";
const GIF_WIDTH_OFFSET: usize = 6;
const GIF_HEIGHT_OFFSET: usize = 8;
const BMP_SIGNATURE: &[u8] = b"BM";
const BMP_WIDTH_OFFSET: usize = 18;
const BMP_HEIGHT_OFFSET: usize = 22;
const ICO_SIGNATURE: &[u8] = b"\x00\x00\x01\x00";
const ICO_WIDTH_OFFSET: usize = 6;
const ICO_HEIGHT_OFFSET: usize = 7;
const ICO_FULL_SIZE: u32 = 256;
const JPEG_SIGNATURE: &[u8] = b"\xff\xd8";
const JPEG_FIRST_MARKER: usize = 2;
const JPEG_MARKER_PREFIX: u8 = 0xff;
const JPEG_MARKER_BYTES: usize = 2;
const JPEG_LENGTH_OFFSET: usize = 2;
const JPEG_MIN_SEGMENT_LENGTH: u16 = 2;
const JPEG_HEIGHT_OFFSET: usize = 5;
const JPEG_WIDTH_OFFSET: usize = 7;
const RIFF_SIGNATURE: &[u8] = b"RIFF";
const WEBP_FORM: &[u8] = b"WEBP";
const WEBP_FORM_RANGE: Range<usize> = 8..12;
const WEBP_CHUNK_RANGE: Range<usize> = 12..16;
const VP8X_WIDTH_OFFSET: usize = 24;
const VP8X_HEIGHT_OFFSET: usize = 27;
const VP8L_PACKED_OFFSET: usize = 21;
const VP8L_HEIGHT_SHIFT: u32 = 14;
const VP8_WIDTH_OFFSET: usize = 26;
const VP8_HEIGHT_OFFSET: usize = 28;
const FOURTEEN_BIT_MASK: u32 = 0x3fff;
fn be16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes([
        *bytes.get(offset)?,
        *bytes.get(offset + 1)?,
    ]))
}
fn le16(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u16::from_le_bytes([*bytes.get(offset)?, *bytes.get(offset + 1)?]).into())
}
fn word(bytes: &[u8], offset: usize) -> Option<[u8; WORD_BYTES]> {
    bytes.get(offset..offset + WORD_BYTES)?.try_into().ok()
}
fn be32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(word(bytes, offset)?))
}
fn le32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(word(bytes, offset)?))
}
fn le_signed32(bytes: &[u8], offset: usize) -> Option<i32> {
    Some(i32::from_le_bytes(word(bytes, offset)?))
}
fn le24(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *bytes.get(offset)?,
        *bytes.get(offset + 1)?,
        *bytes.get(offset + 2)?,
        0,
    ]))
}
fn is_standalone_marker(marker: u8) -> bool {
    matches!(marker, 0xff | 0x00 | 0x01 | 0xd0..=0xd9)
}
fn is_start_of_frame(marker: u8) -> bool {
    matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf)
}
fn jpeg_dimensions(bytes: &[u8]) -> Option<Dimensions> {
    let mut offset = JPEG_FIRST_MARKER;
    while offset + 1 < bytes.len() {
        if bytes[offset] != JPEG_MARKER_PREFIX {
            offset += 1;
            continue;
        }
        let marker = bytes[offset + 1];
        if is_standalone_marker(marker) {
            offset += JPEG_MARKER_BYTES;
            continue;
        }
        if is_start_of_frame(marker) {
            return Some(Dimensions {
                width: be16(bytes, offset + JPEG_WIDTH_OFFSET)?.into(),
                height: be16(bytes, offset + JPEG_HEIGHT_OFFSET)?.into(),
            });
        }
        let length = be16(bytes, offset + JPEG_LENGTH_OFFSET)?.max(JPEG_MIN_SEGMENT_LENGTH);
        offset += JPEG_MARKER_BYTES + usize::from(length);
    }
    None
}
fn webp_dimensions(bytes: &[u8]) -> Option<Dimensions> {
    match bytes.get(WEBP_CHUNK_RANGE)? {
        b"VP8X" => Some(Dimensions {
            width: le24(bytes, VP8X_WIDTH_OFFSET)? + 1,
            height: le24(bytes, VP8X_HEIGHT_OFFSET)? + 1,
        }),
        b"VP8L" => {
            let packed = le32(bytes, VP8L_PACKED_OFFSET)?;
            Some(Dimensions {
                width: (packed & FOURTEEN_BIT_MASK) + 1,
                height: ((packed >> VP8L_HEIGHT_SHIFT) & FOURTEEN_BIT_MASK) + 1,
            })
        }
        b"VP8 " => Some(Dimensions {
            width: le16(bytes, VP8_WIDTH_OFFSET)? & FOURTEEN_BIT_MASK,
            height: le16(bytes, VP8_HEIGHT_OFFSET)? & FOURTEEN_BIT_MASK,
        }),
        _ => None,
    }
}
fn ico_size(value: u8) -> u32 {
    if value == 0 {
        return ICO_FULL_SIZE;
    }
    value.into()
}
fn is_webp(bytes: &[u8]) -> bool {
    bytes.starts_with(RIFF_SIGNATURE) && bytes.get(WEBP_FORM_RANGE) == Some(WEBP_FORM)
}
pub fn dimensions(bytes: &[u8]) -> Option<Dimensions> {
    if bytes.starts_with(PNG_SIGNATURE) {
        return Some(Dimensions {
            width: be32(bytes, PNG_WIDTH_OFFSET)?,
            height: be32(bytes, PNG_HEIGHT_OFFSET)?,
        });
    }
    if bytes.starts_with(GIF_SIGNATURE) {
        return Some(Dimensions {
            width: le16(bytes, GIF_WIDTH_OFFSET)?,
            height: le16(bytes, GIF_HEIGHT_OFFSET)?,
        });
    }
    if bytes.starts_with(BMP_SIGNATURE) {
        return Some(Dimensions {
            width: le_signed32(bytes, BMP_WIDTH_OFFSET)?.unsigned_abs(),
            height: le_signed32(bytes, BMP_HEIGHT_OFFSET)?.unsigned_abs(),
        });
    }
    if bytes.starts_with(ICO_SIGNATURE) {
        return Some(Dimensions {
            width: ico_size(*bytes.get(ICO_WIDTH_OFFSET)?),
            height: ico_size(*bytes.get(ICO_HEIGHT_OFFSET)?),
        });
    }
    if bytes.starts_with(JPEG_SIGNATURE) {
        return jpeg_dimensions(bytes);
    }
    if is_webp(bytes) {
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
        .map_err(|_| Error::unexpected("Malformed diff range"))?;
    let count = parts
        .next()
        .unwrap_or("1")
        .parse()
        .map_err(|_| Error::unexpected("Malformed diff count"))?;
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
            if parts.len() < HUNK_HEADER_PARTS {
                return Err(Error::unexpected("Malformed hunk header"));
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
                        let number = new;
                        new += 1;
                        ("add", None, Some(number))
                    }
                    '-' => {
                        let number = old;
                        old += 1;
                        ("remove", Some(number), None)
                    }
                    ' ' => {
                        let (old_line, new_line) = (old, new);
                        old += 1;
                        new += 1;
                        ("context", Some(old_line), Some(new_line))
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
    let mut budget = MARK_BUDGET;
    for hunk in &mut diff.hunks {
        mark_words(&mut hunk.lines, &mut budget);
    }
    Ok(diff)
}
pub const MARK_LINE_LIMIT: usize = 2_000;
pub const MARK_BUDGET: usize = 4_000_000;
fn utf16_width(text: &str) -> u32 {
    u32::try_from(text.encode_utf16().count()).unwrap_or(u32::MAX)
}
fn push(marks: &mut Vec<[u32; 2]>, start: u32, end: u32) {
    match marks.last_mut() {
        Some(last) if last[1] == start => last[1] = end,
        _ => marks.push([start, end]),
    }
}
const PAIR_THRESHOLD: f32 = 0.4;
const EMPHASIS_LIMIT_PERCENT: usize = 50;
const FULL_PERCENT: usize = 100;
const ALIGN_CELLS: usize = 10_000;
const ANCHOR_LINES: usize = 4_000;
fn blank(token: &str) -> bool {
    token.starts_with(char::is_whitespace)
}
#[derive(Clone, Copy, PartialEq)]
enum CharClass {
    Whitespace,
    Word,
    Symbol,
}
fn char_class(character: char) -> CharClass {
    if character.is_whitespace() {
        return CharClass::Whitespace;
    }
    if character.is_alphanumeric() || character == '_' {
        return CharClass::Word;
    }
    CharClass::Symbol
}
fn tokens(text: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut start = 0;
    let mut previous = None;
    for (offset, character) in text.char_indices() {
        let kind = char_class(character);
        if offset > start && (kind == CharClass::Symbol || previous != Some(kind)) {
            found.push(&text[start..offset]);
            start = offset;
        }
        previous = Some(kind);
    }
    if start < text.len() {
        found.push(&text[start..]);
    }
    found
}
fn words(text: &str) -> Vec<&str> {
    tokens(text.trim())
        .into_iter()
        .filter(|token| !blank(token))
        .collect()
}
fn similarity(old: &str, new: &str) -> f32 {
    TextDiff::from_slices(&words(old), &words(new)).ratio()
}
fn ranges(line: &str, tokens: &[&str], changed: &[bool]) -> Marks {
    let mut marks = Vec::new();
    let mut offset = utf16_width(&line[..line.len() - line.trim_start().len()]);
    for (index, token) in tokens.iter().enumerate() {
        let size = utf16_width(token);
        let bridged = blank(token)
            && index > 0
            && changed[index - 1]
            && changed.get(index + 1) == Some(&true);
        if changed[index] || bridged {
            push(&mut marks, offset, offset + size);
        }
        offset += size;
    }
    marks
}
type Marks = Vec<[u32; 2]>;
fn mark_pair(old: &str, new: &str) -> Option<(Marks, Marks)> {
    let (old_trimmed, new_trimmed) = (old.trim(), new.trim());
    let (old_tokens, new_tokens) = (tokens(old_trimmed), tokens(new_trimmed));
    let mut old_changed = Vec::with_capacity(old_tokens.len());
    let mut new_changed = Vec::with_capacity(new_tokens.len());
    for change in TextDiff::from_slices(&old_tokens, &new_tokens).iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                old_changed.push(false);
                new_changed.push(false);
            }
            ChangeTag::Delete => old_changed.push(true),
            ChangeTag::Insert => new_changed.push(true),
        }
    }
    let changed_bytes = |tokens: &[&str], changed: &[bool]| -> usize {
        tokens
            .iter()
            .zip(changed)
            .filter(|(token, changed)| **changed && !blank(token))
            .map(|(token, _)| token.len())
            .sum()
    };
    let changed =
        changed_bytes(&old_tokens, &old_changed).max(changed_bytes(&new_tokens, &new_changed));
    let longest = old_trimmed.len().max(new_trimmed.len());
    if changed * FULL_PERCENT > EMPHASIS_LIMIT_PERCENT * longest {
        return None;
    }
    Some((
        ranges(old, &old_tokens, &old_changed),
        ranges(new, &new_tokens, &new_changed),
    ))
}
fn align(
    removed: &[Line],
    added: &[Line],
    old: Range<usize>,
    new: Range<usize>,
    budget: &mut usize,
    pairs: &mut Vec<(usize, usize)>,
) {
    let (rows, columns) = (old.len(), new.len());
    if rows == 0 || columns == 0 {
        return;
    }
    let scorable = |line: &Line| line.content.len() <= MARK_LINE_LIMIT;
    let cost: usize = if rows * columns > ALIGN_CELLS {
        usize::MAX
    } else {
        removed[old.clone()]
            .iter()
            .flat_map(|removed_line| {
                added[new.clone()]
                    .iter()
                    .map(move |added_line| (removed_line, added_line))
            })
            .filter(|(removed_line, added_line)| scorable(removed_line) && scorable(added_line))
            .map(|(removed_line, added_line)| removed_line.content.len() + added_line.content.len())
            .sum()
    };
    if cost > *budget {
        if rows == columns {
            pairs.extend(old.zip(new));
        }
        return;
    }
    *budget -= cost;
    let score: Vec<Vec<f32>> = removed[old.clone()]
        .iter()
        .map(|removed_line| {
            added[new.clone()]
                .iter()
                .map(|added_line| {
                    if scorable(removed_line) && scorable(added_line) {
                        similarity(&removed_line.content, &added_line.content)
                    } else {
                        0.0
                    }
                })
                .collect()
        })
        .collect();
    let mut best = vec![vec![0.0f32; columns + 1]; rows + 1];
    for row in (0..rows).rev() {
        for column in (0..columns).rev() {
            let skip = best[row + 1][column].max(best[row][column + 1]);
            best[row][column] = if score[row][column] >= PAIR_THRESHOLD {
                skip.max(best[row + 1][column + 1] + score[row][column])
            } else {
                skip
            };
        }
    }
    let (mut row, mut column) = (0, 0);
    while row < rows && column < columns {
        let skip = best[row + 1][column].max(best[row][column + 1]);
        if score[row][column] >= PAIR_THRESHOLD
            && best[row + 1][column + 1] + score[row][column] > skip
        {
            pairs.push((old.start + row, new.start + column));
            row += 1;
            column += 1;
        } else if best[row + 1][column] >= best[row][column + 1] {
            row += 1;
        } else {
            column += 1;
        }
    }
}
fn pairs(removed: &[Line], added: &[Line], budget: &mut usize) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    if removed.len() + added.len() > ANCHOR_LINES {
        align(
            removed,
            added,
            0..removed.len(),
            0..added.len(),
            budget,
            &mut found,
        );
        return found;
    }
    let old: Vec<&str> = removed.iter().map(|line| line.content.trim()).collect();
    let new: Vec<&str> = added.iter().map(|line| line.content.trim()).collect();
    let (mut old_at, mut new_at) = (0, 0);
    for op in TextDiff::from_slices(&old, &new).ops() {
        if op.tag() == DiffTag::Equal {
            let (old_range, new_range) = (op.old_range(), op.new_range());
            align(
                removed,
                added,
                old_at..old_range.start,
                new_at..new_range.start,
                budget,
                &mut found,
            );
            (old_at, new_at) = (old_range.end, new_range.end);
        }
    }
    align(
        removed,
        added,
        old_at..removed.len(),
        new_at..added.len(),
        budget,
        &mut found,
    );
    found
}
fn mark(lines: &mut [Line], old: usize, new: usize, budget: &mut usize) {
    let (old_text, new_text) = (&lines[old].content, &lines[new].content);
    if old_text.len() > MARK_LINE_LIMIT || new_text.len() > MARK_LINE_LIMIT {
        return;
    }
    let cost = old_text.len() + new_text.len();
    if cost > *budget {
        *budget = 0;
        return;
    }
    *budget -= cost;
    if let Some((old_marks, new_marks)) = mark_pair(old_text, new_text) {
        lines[old].marks = old_marks;
        lines[new].marks = new_marks;
    }
}
fn mark_words(lines: &mut [Line], budget: &mut usize) {
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
        for (old, new) in pairs(&lines[start..added], &lines[added..position], budget) {
            mark(lines, start + old, added + new, budget);
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
            &git::commit_of(revision),
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
    git::nul_list(
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
    .await
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
        if !common.succeeded() {
            return Err(Error::refused(
                "These branches have no common commit. Turn off \"Since branches diverged\" to compare them directly.",
            ));
        }
        base = common.text().trim().to_owned();
    }
    let statuses = tree_diff(repo, "--name-status", &base, &target).await?;
    let counts = tree_diff(repo, "--numstat", &base, &target).await?;
    let files = statuses
        .chunks(NAME_STATUS_FIELDS)
        .zip(counts)
        .map(|(entry, count)| {
            let mut numbers = count.split('\t');
            let mut number = || {
                numbers
                    .next()
                    .and_then(|field| field.parse().ok())
                    .unwrap_or(0)
            };
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
async fn renamed_from(repo: &Repo, path: &str) -> Result<Option<String>> {
    Ok(repo
        .snapshot()
        .await?
        .entries
        .iter()
        .find(|entry| entry.path() == path)
        .and_then(|entry| entry.original_path())
        .map(String::from))
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
        return Ok(Blob::Object(git::object_at(
            &git::stash_untracked(&sha),
            path,
        )));
    }
    let reference = match source {
        "staged" if old => git::HEAD.into(),
        "staged" | "unstaged" => String::new(),
        "commit" | "stash" => {
            let sha = resolve(repo, revision).await?;
            if old {
                git::first_parent(&sha)
            } else {
                sha
            }
        }
        "compare" if old => resolve(repo, base).await?,
        "compare" => resolve(repo, revision).await?,
        _ => return Err(Error::refused("Unknown diff source")),
    };
    let original = if old && source == "staged" {
        renamed_from(repo, path).await?
    } else {
        None
    };
    let spec = git::object_at(&reference, original.as_deref().unwrap_or(path));
    let exists = git::run(&repo.root, &["cat-file", "-e", &spec], None).await?;
    if exists.succeeded() {
        return Ok(Blob::Object(spec));
    }
    if missing_object(&exists.stderr) {
        return Ok(Blob::Absent);
    }
    Err(Error::git(exists.message()))
}
async fn object_bytes(repo: &Repo, spec: &str) -> Result<Vec<u8>> {
    Ok(git::run(&repo.root, &["show", spec], None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?
        .bytes)
}
async fn object_size(repo: &Repo, spec: &str) -> Result<usize> {
    git::text(&repo.root, &["cat-file", "-s", spec])
        .await?
        .trim()
        .parse()
        .map_err(|_| Error::unexpected("Invalid Git object size"))
}
async fn blob_bytes(repo: &Repo, blob: &Blob) -> Result<Vec<u8>> {
    match blob {
        Blob::Absent => Ok(Vec::new()),
        Blob::Object(spec) => object_bytes(repo, spec).await,
        Blob::Working(path) => Ok(fs::read_if_present(path)?),
    }
}

pub async fn bytes(
    repo: &Repo,
    path: &str,
    source: &str,
    revision: &str,
    base: &str,
    old: bool,
) -> Result<Vec<u8>> {
    blob_bytes(
        repo,
        &location(repo, path, source, revision, base, old).await?,
    )
    .await
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
        Blob::Object(spec) => object_size(repo, &spec).await,
        Blob::Working(path) => Ok(fs::size_if_present(&path)?),
    }
}
pub const LINE_LIMIT: usize = 50000;
pub const BYTES_PER_MEGABYTE: usize = 1024 * 1024;
pub const BLOB_SIZE_LIMIT: usize = 20 * BYTES_PER_MEGABYTE;
const TEXT_SIZE_LIMIT: usize = 2 * BYTES_PER_MEGABYTE;
pub fn over_line_limit(text: &str) -> bool {
    fs::count_lines(text) > LINE_LIMIT
}
pub fn size_limit(image: bool) -> usize {
    if image {
        BLOB_SIZE_LIMIT
    } else {
        TEXT_SIZE_LIMIT
    }
}
pub async fn text(
    repo: &Repo,
    path: &str,
    source: &str,
    revision: &str,
    base: &str,
    old: bool,
) -> Result<Option<String>> {
    if size(repo, path, source, revision, base, old).await? > size_limit(false) {
        return Ok(None);
    }
    let bytes = bytes(repo, path, source, revision, base, old).await?;
    if fs::is_binary(&bytes) {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&bytes);
    if over_line_limit(&text) {
        return Ok(None);
    }
    Ok(Some(text.into_owned()))
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
    let input: String = specs
        .iter()
        .map(|spec| format!("{spec}{}", git::NUL))
        .collect();
    let text = git::run(
        &repo.root,
        &["cat-file", "--batch-check", "-z"],
        Some(input.as_bytes()),
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?
    .text();
    let invalid = || Error::unexpected("Invalid Git object size");
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
async fn measure(repo: &Repo, side: &Blob, size: Option<usize>) -> Result<usize> {
    match (side, size) {
        (Blob::Absent, _) => Ok(0),
        (Blob::Object(_), Some(size)) => Ok(size),
        (Blob::Object(spec), None) => {
            let exists = git::run(&repo.root, &["cat-file", "-e", spec], None).await?;
            if exists.succeeded() {
                return object_size(repo, spec).await;
            }
            if missing_object(&exists.stderr) {
                return Ok(0);
            }
            Err(Error::git(exists.message()))
        }
        (Blob::Working(path), _) => Ok(fs::size_if_present(path)?),
    }
}
async fn side_bytes(repo: &Repo, side: &Blob, size: usize) -> Result<Vec<u8>> {
    match side {
        Blob::Object(_) if size == 0 => Ok(Vec::new()),
        _ => blob_bytes(repo, side).await,
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
            (git::first_parent(&sha), sha)
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
    let original = if source == "staged" {
        renamed_from(repo, path).await?
    } else {
        None
    };
    let (old, new) = match source {
        "file" => (Blob::Absent, Blob::Working(full)),
        _ if untracked => (
            Blob::Absent,
            Blob::Object(git::object_at(&git::stash_untracked(&sha), path)),
        ),
        "unstaged" => (Blob::Object(git::index_object(path)), Blob::Working(full)),
        "staged" => (
            Blob::Object(git::object_at(
                git::HEAD,
                original.as_deref().unwrap_or(path),
            )),
            Blob::Object(git::index_object(path)),
        ),
        _ => (
            Blob::Object(git::object_at(&parent, path)),
            Blob::Object(git::object_at(&sha, path)),
        ),
    };
    let rooted = matches!(source, "commit" | "stash") && !untracked;
    let mut specs = Vec::new();
    if rooted {
        specs.push(parent.as_str());
    }
    for side in [&old, &new] {
        if let Blob::Object(spec) = side {
            specs.push(spec.as_str());
        }
    }
    let mut sizes = object_sizes(repo, &specs).await?.into_iter();
    let root = rooted && sizes.next().flatten().is_none();
    let old_size = match old {
        Blob::Object(_) => sizes.next().flatten(),
        _ => None,
    };
    let new_size = match new {
        Blob::Object(_) => sizes.next().flatten(),
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
        if fs::is_binary(&new) {
            result.binary = true;
        } else {
            let content = String::from_utf8_lossy(&new);
            if !override_limit && over_line_limit(&content) {
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
    let context = format!("--unified={}", context.min(MAX_CONTEXT_LINES));
    let mut arguments = vec!["diff"];
    arguments.extend(git::PINNED_DIFF_FLAGS);
    arguments.extend(["--find-renames", &context]);
    if source == "staged" {
        arguments.push("--cached");
    } else if source == "unstaged" {
        arguments.splice(0..1, ["diff-files", "-p"]);
    } else if root {
        arguments = vec!["show", "--root", git::EMPTY_FORMAT];
        arguments.extend(git::PINNED_DIFF_FLAGS);
        arguments.extend([context.as_str(), sha.as_str()]);
    } else {
        arguments.extend([parent.as_str(), sha.as_str()]);
    }
    arguments.extend(["--", path]);
    if let Some(original) = &original {
        arguments.push(original);
    }
    let output = git::text(&repo.root, &arguments).await?;
    if !override_limit && over_line_limit(&output) {
        result.too_large = true;
        return Ok(result);
    }
    let mut parsed = parse(&output, path, source)?;
    parsed.old_size = result.old_size;
    parsed.new_size = result.new_size;
    Ok(parsed)
}
pub fn patch(path: &str, hunk: &Hunk) -> Result<String> {
    if path.contains(['\n', '\r', git::NUL]) {
        return Err(Error::refused("Hunk actions are unavailable for paths containing control characters; use file staging"));
    }
    let old_path = quote::always_quoted(quote::OLD_PREFIX, path);
    let new_path = quote::always_quoted(quote::NEW_PREFIX, path);
    let mut patch = format!(
        "{}\n--- {old_path}\n+++ {new_path}\n@@ -{},{} +{},{} @@\n",
        quote::diff_header(&old_path, &new_path),
        hunk.old_start,
        hunk.old_count,
        hunk.new_start,
        hunk.new_count
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
    repo: &Repo,
    path: &str,
    source: &str,
    hunk: usize,
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
    let diff = read(repo, path, source, "", "", DIFF_CONTEXT_LINES, true).await?;
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
    let mut arguments = vec!["apply", "--whitespace=nowarn"];
    if action != "discard" {
        arguments.push("--cached");
    }
    if action != "stage" {
        arguments.push("--reverse");
    }
    git::apply_checked(&repo.root, &arguments, patch.as_bytes())
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
