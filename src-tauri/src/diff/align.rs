use super::{Line, LineKind};
use similar::{ChangeTag, DiffTag, TextDiff};
use std::ops::Range;

pub const MARK_LINE_LIMIT: usize = 2_000;
const PAIR_THRESHOLD: f32 = 0.4;
const EMPHASIS_LIMIT_PERCENT: usize = 50;
const FULL_PERCENT: usize = 100;
const ALIGN_CELLS: usize = 10_000;
const ANCHOR_LINES: usize = 4_000;
const WORD_JOINER: char = '_';

type Marks = Vec<[u32; 2]>;

fn utf16_width(text: &str) -> u32 {
    u32::try_from(text.encode_utf16().count()).unwrap_or(u32::MAX)
}
fn push(marks: &mut Marks, start: u32, end: u32) {
    match marks.last_mut() {
        Some(last) if last[1] == start => last[1] = end,
        _ => marks.push([start, end]),
    }
}
fn blank(token: &str) -> bool {
    token.starts_with(char::is_whitespace)
}
#[derive(Clone, Copy, PartialEq)]
enum CharClass {
    Whitespace,
    Word,
    Symbol,
}
fn is_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == WORD_JOINER
}
fn char_class(character: char) -> CharClass {
    if character.is_whitespace() {
        return CharClass::Whitespace;
    }
    if is_word_character(character) {
        return CharClass::Word;
    }
    CharClass::Symbol
}
fn starts_new_token(kind: CharClass, previous: Option<CharClass>) -> bool {
    kind == CharClass::Symbol || previous != Some(kind)
}
fn tokens(text: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut start = 0;
    let mut previous = None;
    for (offset, character) in text.char_indices() {
        let kind = char_class(character);
        let token_ends = offset > start && starts_new_token(kind, previous);
        if token_ends {
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
fn bridges_changes(tokens: &[&str], changed: &[bool], index: usize) -> bool {
    let follows_change = index > 0 && changed[index - 1];
    let precedes_change = changed.get(index + 1) == Some(&true);
    blank(tokens[index]) && follows_change && precedes_change
}
fn leading_width(line: &str) -> u32 {
    utf16_width(&line[..line.len() - line.trim_start().len()])
}
fn ranges(line: &str, tokens: &[&str], changed: &[bool]) -> Marks {
    let mut marks = Vec::new();
    let mut offset = leading_width(line);
    for (index, token) in tokens.iter().enumerate() {
        let size = utf16_width(token);
        let marked = changed[index] || bridges_changes(tokens, changed, index);
        if marked {
            push(&mut marks, offset, offset + size);
        }
        offset += size;
    }
    marks
}
struct MarkPair {
    old: Marks,
    new: Marks,
}
struct TokenChanges<'a> {
    tokens: Vec<&'a str>,
    changed: Vec<bool>,
}
impl<'a> TokenChanges<'a> {
    fn of(text: &'a str) -> Self {
        let tokens = tokens(text);
        let changed = Vec::with_capacity(tokens.len());
        Self { tokens, changed }
    }
    fn changed_bytes(&self) -> usize {
        self.tokens
            .iter()
            .zip(&self.changed)
            .filter(|(token, changed)| **changed && !blank(token))
            .map(|(token, _)| token.len())
            .sum()
    }
    fn marks(&self, line: &str) -> Marks {
        ranges(line, &self.tokens, &self.changed)
    }
}
fn record_changes(old: &mut TokenChanges<'_>, new: &mut TokenChanges<'_>) {
    for change in TextDiff::from_slices(&old.tokens, &new.tokens).iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                old.changed.push(false);
                new.changed.push(false);
            }
            ChangeTag::Delete => old.changed.push(true),
            ChangeTag::Insert => new.changed.push(true),
        }
    }
}
fn mostly_changed(changed: usize, longest: usize) -> bool {
    changed * FULL_PERCENT > EMPHASIS_LIMIT_PERCENT * longest
}
fn mark_pair(old: &str, new: &str) -> Option<MarkPair> {
    let (old_trimmed, new_trimmed) = (old.trim(), new.trim());
    let mut old_changes = TokenChanges::of(old_trimmed);
    let mut new_changes = TokenChanges::of(new_trimmed);
    record_changes(&mut old_changes, &mut new_changes);
    let changed = old_changes.changed_bytes().max(new_changes.changed_bytes());
    let longest = old_trimmed.len().max(new_trimmed.len());
    if mostly_changed(changed, longest) {
        return None;
    }
    Some(MarkPair {
        old: old_changes.marks(old),
        new: new_changes.marks(new),
    })
}

#[derive(Clone, Copy)]
struct LinePair {
    old: usize,
    new: usize,
}
#[derive(Clone, Copy)]
struct Cell {
    row: usize,
    column: usize,
}
#[derive(PartialEq)]
enum Step {
    Pair,
    SkipRow,
    SkipColumn,
}
impl Step {
    fn paired(&self, cell: Cell) -> Option<Cell> {
        (*self == Self::Pair).then_some(cell)
    }
    fn apply(&self, cell: Cell) -> Cell {
        match self {
            Self::Pair => Cell {
                row: cell.row + 1,
                column: cell.column + 1,
            },
            Self::SkipRow => Cell {
                row: cell.row + 1,
                column: cell.column,
            },
            Self::SkipColumn => Cell {
                row: cell.row,
                column: cell.column + 1,
            },
        }
    }
}
fn scorable(line: &Line) -> bool {
    line.content.len() <= MARK_LINE_LIMIT
}
fn both_scorable(removed: &Line, added: &Line) -> bool {
    scorable(removed) && scorable(added)
}
fn pair_cost(removed: &[Line], added: &[Line]) -> usize {
    removed
        .iter()
        .flat_map(|removed_line| {
            added
                .iter()
                .map(move |added_line| [removed_line, added_line])
        })
        .filter(|[removed_line, added_line]| both_scorable(removed_line, added_line))
        .map(|[removed_line, added_line]| removed_line.content.len() + added_line.content.len())
        .sum()
}
fn alignment_cost(removed: &[Line], added: &[Line]) -> usize {
    if removed.len() * added.len() > ALIGN_CELLS {
        return usize::MAX;
    }
    pair_cost(removed, added)
}
fn pair_score(removed: &Line, added: &Line) -> f32 {
    if !both_scorable(removed, added) {
        return 0.0;
    }
    similarity(&removed.content, &added.content)
}
fn score_row(removed: &Line, added: &[Line]) -> Vec<f32> {
    added
        .iter()
        .map(|added_line| pair_score(removed, added_line))
        .collect()
}
struct Table {
    score: Vec<Vec<f32>>,
    best: Vec<Vec<f32>>,
    rows: usize,
    columns: usize,
}
impl Table {
    fn scored(removed: &[Line], added: &[Line]) -> Self {
        let score = removed
            .iter()
            .map(|removed_line| score_row(removed_line, added))
            .collect();
        let (rows, columns) = (removed.len(), added.len());
        let mut table = Self {
            score,
            best: vec![vec![0.0f32; columns + 1]; rows + 1],
            rows,
            columns,
        };
        table.fill_best();
        table
    }
    fn skip_total(&self, cell: Cell) -> f32 {
        self.best[cell.row + 1][cell.column].max(self.best[cell.row][cell.column + 1])
    }
    fn paired_total(&self, cell: Cell) -> f32 {
        self.best[cell.row + 1][cell.column + 1] + self.score[cell.row][cell.column]
    }
    fn pairs_well(&self, cell: Cell) -> bool {
        self.score[cell.row][cell.column] >= PAIR_THRESHOLD
    }
    fn best_total(&self, cell: Cell) -> f32 {
        let skip = self.skip_total(cell);
        if !self.pairs_well(cell) {
            return skip;
        }
        skip.max(self.paired_total(cell))
    }
    fn fill_row(&mut self, row: usize) {
        for column in (0..self.columns).rev() {
            self.best[row][column] = self.best_total(Cell { row, column });
        }
    }
    fn fill_best(&mut self) {
        for row in (0..self.rows).rev() {
            self.fill_row(row);
        }
    }
    fn next_step(&self, cell: Cell) -> Step {
        let pairing_wins = self.paired_total(cell) > self.skip_total(cell);
        let pairs = self.pairs_well(cell) && pairing_wins;
        if pairs {
            return Step::Pair;
        }
        if self.best[cell.row + 1][cell.column] >= self.best[cell.row][cell.column + 1] {
            return Step::SkipRow;
        }
        Step::SkipColumn
    }
    fn inside(&self, cell: Cell) -> bool {
        cell.row < self.rows && cell.column < self.columns
    }
    fn matched_cells(&self) -> Vec<Cell> {
        let mut matched = Vec::new();
        let mut cell = Cell { row: 0, column: 0 };
        while self.inside(cell) {
            let step = self.next_step(cell);
            matched.extend(step.paired(cell));
            cell = step.apply(cell);
        }
        matched
    }
}
struct Aligner<'a> {
    removed: &'a [Line],
    added: &'a [Line],
    budget: &'a mut usize,
    pairs: Vec<LinePair>,
}
impl Aligner<'_> {
    fn pair_in_order(&mut self, old: Range<usize>, new: Range<usize>) {
        if old.len() != new.len() {
            return;
        }
        self.pairs
            .extend(old.zip(new).map(|(old, new)| LinePair { old, new }));
    }
    fn align(&mut self, old: Range<usize>, new: Range<usize>) {
        let nothing_to_align = old.is_empty() || new.is_empty();
        if nothing_to_align {
            return;
        }
        let removed = &self.removed[old.clone()];
        let added = &self.added[new.clone()];
        let cost = alignment_cost(removed, added);
        if cost > *self.budget {
            self.pair_in_order(old, new);
            return;
        }
        *self.budget -= cost;
        let matched = Table::scored(removed, added).matched_cells();
        self.pairs.extend(matched.into_iter().map(|cell| LinePair {
            old: old.start + cell.row,
            new: new.start + cell.column,
        }));
    }
}
fn trimmed_contents(lines: &[Line]) -> Vec<&str> {
    lines.iter().map(|line| line.content.trim()).collect()
}
fn pairs(removed: &[Line], added: &[Line], budget: &mut usize) -> Vec<LinePair> {
    let mut aligner = Aligner {
        removed,
        added,
        budget,
        pairs: Vec::new(),
    };
    if removed.len() + added.len() > ANCHOR_LINES {
        aligner.align(0..removed.len(), 0..added.len());
        return aligner.pairs;
    }
    let old = trimmed_contents(removed);
    let new = trimmed_contents(added);
    let (mut old_offset, mut new_offset) = (0, 0);
    for operation in TextDiff::from_slices(&old, &new).ops() {
        if operation.tag() == DiffTag::Equal {
            let (old_range, new_range) = (operation.old_range(), operation.new_range());
            aligner.align(old_offset..old_range.start, new_offset..new_range.start);
            (old_offset, new_offset) = (old_range.end, new_range.end);
        }
    }
    aligner.align(old_offset..removed.len(), new_offset..added.len());
    aligner.pairs
}
fn too_long_to_mark(old_text: &str, new_text: &str) -> bool {
    old_text.len() > MARK_LINE_LIMIT || new_text.len() > MARK_LINE_LIMIT
}
fn mark(lines: &mut [Line], pair: LinePair, budget: &mut usize) {
    let (old_text, new_text) = (&lines[pair.old].content, &lines[pair.new].content);
    if too_long_to_mark(old_text, new_text) {
        return;
    }
    let cost = old_text.len() + new_text.len();
    if cost > *budget {
        *budget = 0;
        return;
    }
    *budget -= cost;
    if let Some(marks) = mark_pair(old_text, new_text) {
        lines[pair.old].marks = marks.old;
        lines[pair.new].marks = marks.new;
    }
}
fn run_end(lines: &[Line], start: usize, kind: LineKind) -> usize {
    lines[start..]
        .iter()
        .position(|line| line.kind != kind)
        .map_or(lines.len(), |length| start + length)
}
pub fn mark_words(lines: &mut [Line], budget: &mut usize) {
    let mut position = 0;
    while position < lines.len() {
        if lines[position].kind != LineKind::Remove {
            position += 1;
            continue;
        }
        let start = position;
        let added = run_end(lines, start, LineKind::Remove);
        position = run_end(lines, added, LineKind::Add);
        for pair in pairs(&lines[start..added], &lines[added..position], budget) {
            let absolute = LinePair {
                old: start + pair.old,
                new: added + pair.new,
            };
            mark(lines, absolute, budget);
        }
    }
}
