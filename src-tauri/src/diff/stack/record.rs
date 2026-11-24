use super::{
    BUDGET, Stack,
    stream::{Raw, is_rename_status},
};
use crate::{
    diff::{Diff, DiffSource, LINE_LIMIT, parse, parse::HUNK_PREFIX, quote, size_limit},
    error::Result,
    media::is_image,
    repo::Paths,
};
use std::{
    collections::{HashMap, HashSet},
    ops::Range,
    path::PathBuf,
};

const SUBMODULE_MODE: &str = "160000";
const UNMERGED: char = 'U';
const PATCH_LINE_PREFIXES: [char; 3] = ['+', '-', ' '];
pub const FILE_HEADER_PREFIX: &str = "diff --git ";
const SUBMODULE_SUMMARY_PREFIX: &str = "* ";

pub fn controlled(path: &str) -> bool {
    path.chars().any(char::is_control)
}
impl Raw {
    fn old_side_path(&self) -> &str {
        if is_rename_status(self.status) {
            return &self.old_path;
        }
        &self.path
    }
    fn touches_submodule(&self) -> bool {
        self.old_mode == SUBMODULE_MODE || self.new_mode == SUBMODULE_MODE
    }
    fn has_control_characters(&self) -> bool {
        controlled(&self.path) || controlled(&self.old_path)
    }
    fn is_unsupported(&self) -> bool {
        let unmerged = self.status == UNMERGED;
        self.combined || unmerged || self.touches_submodule() || self.has_control_characters()
    }
    fn header(&self) -> String {
        quote::diff_header(
            &quote::quote_path(quote::OLD_PREFIX, self.old_side_path()),
            &quote::quote_path(quote::NEW_PREFIX, &self.path),
        )
    }
}

#[derive(PartialEq)]
pub enum Kind {
    Omit,
    Large,
    Image,
    Text,
}
impl Kind {
    fn initial(omit: bool) -> Self {
        if omit {
            return Self::Omit;
        }
        Self::Text
    }
    fn sized(largest: usize, image: bool) -> Self {
        if largest > size_limit(image) {
            return Self::Large;
        }
        if image {
            return Self::Image;
        }
        Self::Text
    }
}
pub struct Record {
    pub raw: Raw,
    pub header: String,
    pub kind: Kind,
    pub full: Option<PathBuf>,
    pub old_size: usize,
    pub new_size: usize,
}
impl Record {
    pub fn omit(&mut self) {
        self.kind = Kind::Omit;
    }
    pub fn is_kept(&self) -> bool {
        self.kind != Kind::Omit
    }
    pub fn sized(&mut self, old_size: usize, new_size: usize) {
        self.old_size = old_size;
        self.new_size = new_size;
        self.kind = Kind::sized(old_size.max(new_size), is_image(&self.raw.path));
    }
    pub fn entry(&self, source: DiffSource) -> Diff {
        Diff {
            image: is_image(&self.raw.path),
            old_size: self.old_size,
            new_size: self.new_size,
            ..Diff::empty(&self.raw.path, source)
        }
    }
}

pub struct RecordContext<'a, 'repo> {
    pub source: DiffSource,
    pub originals: HashMap<&'a str, Option<&'a str>>,
    pub hidden: HashSet<&'a str>,
    pub paths: &'a mut Paths<'repo>,
}
impl RecordContext<'_, '_> {
    fn paired(&self, raw: &Raw) -> bool {
        if self.source != DiffSource::Staged {
            return true;
        }
        let original = self.originals.get(raw.path.as_str()).copied().flatten();
        if is_rename_status(raw.status) {
            return original == Some(raw.old_path.as_str());
        }
        original.is_none()
    }
    fn omits(&self, raw: &Raw, full: Option<&PathBuf>) -> bool {
        let hidden = self.hidden.contains(raw.path.as_str());
        raw.is_unsupported() || hidden || !self.paired(raw) || full.is_none()
    }
    pub fn record(&mut self, raw: Raw) -> Record {
        let header = raw.header();
        let full = self.paths.resolve(&raw.path).ok();
        let kind = Kind::initial(self.omits(&raw, full.as_ref()));
        Record {
            raw,
            header,
            kind,
            full,
            old_size: 0,
            new_size: 0,
        }
    }
}

#[derive(Default)]
pub struct Section {
    text: String,
    lines: usize,
    counted: usize,
    hunk: bool,
    over: bool,
}
impl Section {
    fn overflow(&mut self) {
        self.over = true;
        self.text = String::new();
    }
    fn count(&mut self, line: &str) {
        if line.starts_with(HUNK_PREFIX) {
            self.hunk = true;
            return;
        }
        let counted_line = self.hunk && line.starts_with(PATCH_LINE_PREFIXES);
        if counted_line {
            self.counted += 1;
        }
    }
    fn push(&mut self, line: &str) {
        self.lines += 1;
        if self.over {
            return;
        }
        if self.lines > LINE_LIMIT {
            self.overflow();
            return;
        }
        self.count(line);
        self.text.push_str(line);
        self.text.push('\n');
    }
}

pub struct OpenSection {
    index: usize,
    section: Section,
}
impl OpenSection {
    fn empty(index: usize) -> Self {
        Self {
            index,
            section: Section::default(),
        }
    }
}
pub struct Builder {
    pub source: DiffSource,
    pub records: Vec<Record>,
    pub stack: Stack,
    pub images: Vec<usize>,
    pub used: usize,
    next: usize,
    open: Option<OpenSection>,
}
fn is_submodule_summary(line: &str) -> bool {
    line.starts_with(SUBMODULE_SUMMARY_PREFIX)
}
impl Builder {
    pub fn new(source: DiffSource, records: Vec<Record>) -> Self {
        Self {
            source,
            records,
            stack: Stack::default(),
            images: Vec::new(),
            used: 0,
            next: 0,
            open: None,
        }
    }
    fn insert(&mut self, entry: Diff) {
        self.stack.files.insert(entry.path.clone(), entry);
    }
    fn finish_text(&mut self, index: usize, section: &Section) -> Result<()> {
        let record = &self.records[index];
        let entry = Diff {
            old_size: record.old_size,
            new_size: record.new_size,
            ..parse(&section.text, &record.raw.path, self.source)?
        };
        self.insert(entry);
        Ok(())
    }
    fn finish_too_large(&mut self, index: usize) {
        let entry = Diff {
            too_large: true,
            ..self.records[index].entry(self.source)
        };
        self.insert(entry);
    }
    fn finish(&mut self, open: OpenSection) -> Result<()> {
        let OpenSection { index, section } = open;
        match self.records[index].kind {
            Kind::Omit => {}
            Kind::Image => self.images.push(index),
            Kind::Text if !section.over => self.finish_text(index, &section)?,
            Kind::Large | Kind::Text => self.finish_too_large(index),
        }
        self.used += section.counted;
        Ok(())
    }
    fn finish_unopened(&mut self, indices: Range<usize>) -> Result<()> {
        for index in indices {
            self.finish(OpenSection::empty(index))?;
        }
        Ok(())
    }
    fn close_open(&mut self) -> Result<()> {
        let Some(open) = self.open.take() else {
            return Ok(());
        };
        self.finish(open)
    }
    fn is_open_header(&self, line: &str) -> bool {
        self.open
            .as_ref()
            .is_some_and(|open| self.records[open.index].header == line)
    }
    fn find_header(&self, line: &str) -> Option<usize> {
        (self.next..self.records.len()).find(|&index| self.records[index].header == line)
    }
    fn enter_file(&mut self, line: &str) -> Result<()> {
        if self.is_open_header(line) {
            return Ok(());
        }
        self.close_open()?;
        let Some(found) = self.find_header(line) else {
            return Ok(());
        };
        self.finish_unopened(self.next..found)?;
        self.next = found + 1;
        self.open = Some(OpenSection::empty(found));
        Ok(())
    }
    fn append(&mut self, line: &str) {
        let Some(open) = self.open.as_mut() else {
            return;
        };
        if self.records[open.index].kind == Kind::Text {
            open.section.push(line);
        }
    }
    pub fn feed(&mut self, line: &str) -> Result<()> {
        if is_submodule_summary(line) {
            return Ok(());
        }
        if line.starts_with(FILE_HEADER_PREFIX) {
            self.enter_file(line)?;
        }
        self.append(line);
        Ok(())
    }
    pub fn over_budget(&self) -> bool {
        let Some(open) = self.open.as_ref() else {
            return false;
        };
        let text = self.records[open.index].kind == Kind::Text;
        text && self.used + open.section.counted > BUDGET
    }
    pub fn complete(&mut self) -> Result<()> {
        self.close_open()?;
        self.finish_unopened(self.next..self.records.len())
    }
}
