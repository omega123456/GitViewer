use crate::{error::Result, variant};
use serde::{Deserialize, Serialize};

mod align;
mod apply;
mod compare;
mod image_size;
mod object;
mod parse;
pub mod quote;
mod read;
pub mod stack;

pub use align::MARK_LINE_LIMIT;
pub use apply::{add_patches, apply_hunk, patch};
pub use compare::{ChangedFile, Comparison, compare};
pub use image_size::dimensions;
pub use object::{
    BLOB_SIZE_LIMIT, BYTES_PER_MEGABYTE, LINE_LIMIT, bytes, over_line_limit, resolve, size,
    size_limit, text,
};
pub use parse::{MARK_BUDGET, parse};
pub use read::{read, read_patched};

pub const DIFF_CONTEXT_LINES: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffSource {
    Staged,
    Unstaged,
    File,
    Commit,
    Stash,
    Compare,
}
impl DiffSource {
    pub fn parse(name: &str) -> Result<Self> {
        variant::parse(name, "Unknown diff source")
    }
    pub fn is_revision(self) -> bool {
        matches!(self, Self::Commit | Self::Stash)
    }
    pub fn is_uncommitted(self) -> bool {
        matches!(self, Self::Staged | Self::Unstaged)
    }
}
#[derive(Clone, Copy, Debug)]
pub struct DiffRef<'a> {
    pub path: &'a str,
    pub source: DiffSource,
    pub revision: &'a str,
    pub base: &'a str,
}
impl<'a> DiffRef<'a> {
    pub fn working(path: &'a str, source: DiffSource) -> Self {
        Self {
            path,
            source,
            revision: "",
            base: "",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Old,
    New,
}
impl Side {
    pub fn of(old: bool) -> Self {
        if old {
            return Self::Old;
        }
        Self::New
    }
}
#[derive(Clone, Copy, Debug)]
pub struct ReadOptions {
    pub context: u32,
    pub override_limit: bool,
}
impl ReadOptions {
    pub const DEFAULT: Self = Self {
        context: DIFF_CONTEXT_LINES,
        override_limit: false,
    };
    pub const UNLIMITED: Self = Self {
        context: DIFF_CONTEXT_LINES,
        override_limit: true,
    };
}
#[derive(Clone, Copy, Debug)]
pub struct Endpoints<'a> {
    pub base: &'a str,
    pub target: &'a str,
}
#[derive(Clone, Copy, Debug)]
pub struct HunkRequest<'a> {
    pub path: &'a str,
    pub source: DiffSource,
    pub hunk: usize,
    pub expected: &'a str,
    pub action: &'a str,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    Add,
    Remove,
    Context,
}
impl LineKind {
    const ALL: [Self; 3] = [Self::Add, Self::Remove, Self::Context];
    fn patch_prefix(self) -> char {
        match self {
            Self::Add => '+',
            Self::Remove => '-',
            Self::Context => ' ',
        }
    }
    fn from_prefix(prefix: char) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.patch_prefix() == prefix)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub kind: LineKind,
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
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub path: String,
    pub source: DiffSource,
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
impl Diff {
    pub fn empty(path: &str, source: DiffSource) -> Self {
        Self {
            path: path.into(),
            source,
            old_mode: None,
            new_mode: None,
            binary: false,
            too_large: false,
            hunks: Vec::new(),
            patches: Vec::new(),
            content: None,
            added: false,
            image: false,
            old_size: 0,
            new_size: 0,
            old_dimensions: None,
            new_dimensions: None,
        }
    }
}
