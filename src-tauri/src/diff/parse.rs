use super::{align::mark_words, Diff, DiffSource, Hunk, Line, LineKind};
use crate::error::{Error, Result};

pub const MARK_BUDGET: usize = 4_000_000;
pub const HUNK_PREFIX: &str = "@@ ";
pub const NO_NEWLINE_MARKER: &str = "\\ No newline at end of file";
const HUNK_HEADER_PARTS: usize = 4;
const OLD_RANGE_PART: usize = 1;
const NEW_RANGE_PART: usize = 2;
const OLD_MODE_PREFIXES: [&str; 2] = ["old mode ", "deleted file mode "];
const NEW_MODE_PREFIXES: [&str; 2] = ["new mode ", "new file mode "];
const BINARY_FILES_PREFIX: &str = "Binary files ";
const BINARY_PATCH_MARKER: &str = "GIT binary patch";

struct LineRange {
    start: u32,
    count: u32,
}
fn range(value: &str) -> Result<LineRange> {
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
    Ok(LineRange { start, count })
}
fn hunk_from_header(header: &str) -> Result<Hunk> {
    let parts: Vec<&str> = header.split_whitespace().collect();
    if parts.len() < HUNK_HEADER_PARTS {
        return Err(Error::unexpected("Malformed hunk header"));
    }
    let old_range = range(parts[OLD_RANGE_PART])?;
    let new_range = range(parts[NEW_RANGE_PART])?;
    Ok(Hunk {
        header: header.into(),
        old_start: old_range.start,
        old_count: old_range.count,
        new_start: new_range.start,
        new_count: new_range.count,
        lines: Vec::new(),
    })
}
fn strip_any<'a>(value: &'a str, prefixes: [&str; 2]) -> Option<&'a str> {
    prefixes
        .into_iter()
        .find_map(|prefix| value.strip_prefix(prefix))
}
fn is_binary_marker(value: &str) -> bool {
    value.starts_with(BINARY_FILES_PREFIX) || value == BINARY_PATCH_MARKER
}

struct LineNumbers {
    old: Option<u32>,
    new: Option<u32>,
}
#[derive(Default)]
struct Cursor {
    old: u32,
    new: u32,
}
impl Cursor {
    fn starting_at(hunk: &Hunk) -> Self {
        Self {
            old: hunk.old_start,
            new: hunk.new_start,
        }
    }
    fn take_old(&mut self) -> u32 {
        let number = self.old;
        self.old += 1;
        number
    }
    fn take_new(&mut self) -> u32 {
        let number = self.new;
        self.new += 1;
        number
    }
    fn number(&mut self, kind: LineKind) -> LineNumbers {
        match kind {
            LineKind::Add => LineNumbers {
                old: None,
                new: Some(self.take_new()),
            },
            LineKind::Remove => LineNumbers {
                old: Some(self.take_old()),
                new: None,
            },
            LineKind::Context => LineNumbers {
                old: Some(self.take_old()),
                new: Some(self.take_new()),
            },
        }
    }
}

struct Parser {
    diff: Diff,
    cursor: Cursor,
}
impl Parser {
    fn line(&mut self, value: &str) -> Result<()> {
        if value.starts_with(HUNK_PREFIX) {
            return self.start_hunk(value);
        }
        if self.diff.hunks.is_empty() {
            self.header_line(value);
            return Ok(());
        }
        self.hunk_line(value);
        Ok(())
    }
    fn start_hunk(&mut self, value: &str) -> Result<()> {
        let hunk = hunk_from_header(value)?;
        self.cursor = Cursor::starting_at(&hunk);
        self.diff.hunks.push(hunk);
        Ok(())
    }
    fn header_line(&mut self, value: &str) {
        if let Some(mode) = strip_any(value, OLD_MODE_PREFIXES) {
            self.diff.old_mode = Some(mode.into());
            return;
        }
        if let Some(mode) = strip_any(value, NEW_MODE_PREFIXES) {
            self.diff.new_mode = Some(mode.into());
            return;
        }
        if is_binary_marker(value) {
            self.diff.binary = true;
        }
    }
    fn hunk_line(&mut self, value: &str) {
        if value == NO_NEWLINE_MARKER {
            self.mark_no_newline();
            return;
        }
        let Some(kind) = value.chars().next().and_then(LineKind::from_prefix) else {
            return;
        };
        let numbers = self.cursor.number(kind);
        let Some(hunk) = self.diff.hunks.last_mut() else {
            return;
        };
        hunk.lines.push(Line {
            kind,
            content: value[1..].into(),
            old: numbers.old,
            new: numbers.new,
            no_newline: false,
            marks: Vec::new(),
        });
    }
    fn mark_no_newline(&mut self) {
        let last = self
            .diff
            .hunks
            .last_mut()
            .and_then(|hunk| hunk.lines.last_mut());
        if let Some(line) = last {
            line.no_newline = true;
        }
    }
}

pub fn parse(text: &str, path: &str, source: DiffSource) -> Result<Diff> {
    let mut parser = Parser {
        diff: Diff::empty(path, source),
        cursor: Cursor::default(),
    };
    for value in text.split_terminator('\n') {
        parser.line(value)?;
    }
    let mut diff = parser.diff;
    let mut budget = MARK_BUDGET;
    for hunk in &mut diff.hunks {
        mark_words(&mut hunk.lines, &mut budget);
    }
    Ok(diff)
}
