use crate::{
    diff::{DiffSource, resolve},
    error::{Error, Result},
    git,
    graph::{Commit, Lane, lanes},
    lines::{Lines, numstat},
    repo::Repo,
};
use serde::Serialize;
use std::{collections::BTreeMap, sync::atomic::Ordering};

#[derive(Clone, Debug, Serialize)]
pub struct Page {
    pub commits: Vec<Commit>,
    pub cursor: Option<String>,
}
pub struct Session {
    child: tokio::process::Child,
    reader: tokio::io::BufReader<tokio::process::ChildStdout>,
    stderr: Option<tokio::task::JoinHandle<std::io::Result<Vec<u8>>>>,
    lanes: Vec<Lane>,
    cursor: Cursor,
}
struct KeptPage {
    cursor: String,
    page: Page,
}
#[derive(Default)]
struct Cursor {
    kept: Option<KeptPage>,
    next: String,
}
impl Cursor {
    fn replay(&self, cursor: &str) -> Option<&Page> {
        self.kept
            .as_ref()
            .filter(|kept| kept.cursor == cursor)
            .map(|kept| &kept.page)
    }
    fn expects(&self, cursor: &str) -> bool {
        self.next == cursor
    }
    fn after(cursor: &str, page: &Page) -> Self {
        Self {
            kept: Some(KeptPage {
                cursor: cursor.into(),
                page: page.clone(),
            }),
            next: page.cursor.clone().unwrap_or_default(),
        }
    }
}
fn parse_commit(fields: Vec<String>) -> Commit {
    let mut fields = fields.into_iter();
    let mut next = || fields.next().unwrap_or_default();
    let hash = next().trim().into();
    let parents = next().split_whitespace().map(String::from).collect();
    let author = next();
    let timestamp = next().parse().unwrap_or_default();
    let refs = next();
    let subject = next();
    Commit {
        hash,
        parents,
        author,
        timestamp,
        refs,
        subject,
        lane: 0,
        color: 0,
        entered: false,
        segments: Vec::new(),
    }
}
const PAGE_SIZE: usize = 100;
const HISTORY_FIELDS: usize = 6;
const HISTORY_FORMAT: &str = "--format=%H%x00%P%x00%an%x00%at%x00%D%x00%s%x00";
const DETAIL_FORMAT: &str = "--format=%H%x00%an%x00%at%x00%s%x00%b";
const DETAIL_FIELDS: usize = 5;
impl Session {
    fn start(repo: &Repo, path: &str) -> Result<Self> {
        let mut arguments = vec!["log", "--date-order", HISTORY_FORMAT];
        if !path.is_empty() {
            arguments.extend(["--", path]);
        }
        let piped = git::spawn_piped(&mut git::command("git", &repo.root, &arguments))?;
        drop(piped.stdin);
        Ok(Self {
            child: piped.child,
            reader: tokio::io::BufReader::new(piped.stdout),
            stderr: Some(git::collect(piped.stderr)),
            lanes: Vec::new(),
            cursor: Cursor::default(),
        })
    }
    async fn stderr_text(&mut self) -> Result<String> {
        let Some(task) = self.stderr.take() else {
            return Ok(String::new());
        };
        Ok(String::from_utf8_lossy(&git::finish(task).await?).into_owned())
    }
    async fn finish(&mut self) -> Result<()> {
        let code = self.child.wait().await?;
        let stderr = self.stderr_text().await?;
        let unborn = code.code() == Some(git::EXIT_FATAL) && stderr.contains(UNBORN_MESSAGE);
        let failed = !code.success() && !unborn;
        if failed {
            return Err(Error::git(stderr));
        }
        Ok(())
    }
    async fn page(&mut self, cursor: &str) -> Result<Page> {
        if let Some(page) = self.cursor.replay(cursor) {
            return Ok(page.clone());
        }
        if !self.cursor.expects(cursor) {
            return Err(Error::refused(
                "History changed; reload from the first page",
            ));
        }
        let mut batch = read_commits(&mut self.reader).await?;
        if batch.ended {
            self.finish().await?;
        }
        lanes(&mut batch.commits, &mut self.lanes);
        let page = Page {
            cursor: batch.next_cursor(),
            commits: batch.commits,
        };
        self.cursor = Cursor::after(cursor, &page);
        Ok(page)
    }
}
const UNBORN_MESSAGE: &str = "does not have any commits yet";
type HistoryReader = tokio::io::BufReader<tokio::process::ChildStdout>;
async fn next_field(reader: &mut HistoryReader, first: bool) -> Result<Option<String>> {
    use tokio::io::AsyncBufReadExt;
    let mut bytes = Vec::new();
    let count = reader.read_until(git::NUL_BYTE, &mut bytes).await?;
    let blank_record = first && bytes.iter().all(u8::is_ascii_whitespace);
    let finished = count == 0 || blank_record;
    if finished {
        return Ok(None);
    }
    if bytes.last() == Some(&git::NUL_BYTE) {
        bytes.pop();
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}
async fn read_commit(reader: &mut HistoryReader) -> Result<Option<Commit>> {
    let mut fields = Vec::new();
    for _ in 0..HISTORY_FIELDS {
        let Some(field) = next_field(reader, fields.is_empty()).await? else {
            return Ok(None);
        };
        fields.push(field);
    }
    Ok(Some(parse_commit(fields)))
}
struct CommitBatch {
    commits: Vec<Commit>,
    ended: bool,
}
impl CommitBatch {
    fn next_cursor(&self) -> Option<String> {
        if self.ended {
            return None;
        }
        self.commits.last().map(|commit| commit.hash.clone())
    }
}
async fn read_commits(reader: &mut HistoryReader) -> Result<CommitBatch> {
    let mut commits = Vec::new();
    while commits.len() < PAGE_SIZE {
        let Some(commit) = read_commit(reader).await? else {
            return Ok(CommitBatch {
                commits,
                ended: true,
            });
        };
        commits.push(commit);
    }
    Ok(CommitBatch {
        commits,
        ended: false,
    })
}
pub async fn page(repo: &Repo, cursor: &str, path: &str) -> Result<Page> {
    if !path.is_empty() {
        repo.path(path)?;
    }
    let mut histories = repo.histories.lock().await;
    if repo.history_stale.swap(false, Ordering::SeqCst) {
        histories.clear();
    }
    if cursor.is_empty() {
        let session = Session::start(repo, path)?;
        histories.insert(path.into(), session);
    }
    histories
        .get_mut(path)
        .ok_or_else(|| Error::refused("History cursor expired; reload the first page"))?
        .page(cursor)
        .await
}
#[derive(Debug, Default, Serialize)]
pub struct CommitFiles {
    pub statuses: BTreeMap<String, String>,
    pub lines: BTreeMap<String, Lines>,
}
pub async fn files(repo: &Repo, revision: &str) -> Result<CommitFiles> {
    let sha = resolve(repo, revision).await?;
    let parents = git::text(&repo.root, &["rev-list", "--parents", "-n", "1", &sha]).await?;
    let parent = parents.split_whitespace().nth(1);
    let mut arguments = vec![
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--raw",
        "--numstat",
        "-r",
        "-z",
    ];
    if let Some(parent) = parent {
        arguments.push(parent);
    }
    arguments.push(&sha);
    let output = git::text(&repo.root, &arguments).await?;
    Ok(parse_commit_files(&output))
}
const RAW_PREFIX: char = ':';
const RAW_FIELD_SEPARATOR: char = ' ';
fn parse_commit_files(output: &str) -> CommitFiles {
    let mut statuses = BTreeMap::new();
    let mut fields = output.split(git::NUL);
    let mut counts = String::new();
    while let Some(field) = fields.next() {
        let Some(raw) = field.strip_prefix(RAW_PREFIX) else {
            counts.push_str(field);
            counts.push(git::NUL);
            continue;
        };
        let letter = raw.rsplit(RAW_FIELD_SEPARATOR).next().unwrap_or_default();
        let path = fields.next().unwrap_or_default();
        statuses.insert(path.to_owned(), letter.chars().take(1).collect());
    }
    CommitFiles {
        statuses,
        lines: numstat(&counts),
    }
}
#[derive(Debug, Serialize)]
pub struct CommitDetail {
    pub hash: String,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
    pub body: String,
}
pub async fn files_with_untracked(
    repo: &Repo,
    revision: &str,
    source: Option<DiffSource>,
) -> Result<CommitFiles> {
    let mut files = files(repo, revision).await?;
    if source != Some(DiffSource::Stash) {
        return Ok(files);
    }
    for path in crate::stash::untracked(repo, revision).await? {
        files
            .statuses
            .entry(path)
            .or_insert_with(|| git::UNTRACKED.into());
    }
    Ok(files)
}
pub async fn detail(repo: &Repo, revision: &str) -> Result<CommitDetail> {
    let sha = resolve(repo, revision).await?;
    let output = git::text(&repo.root, &["show", "-s", DETAIL_FORMAT, &sha]).await?;
    let mut fields = output.splitn(DETAIL_FIELDS, git::NUL);
    let mut next = || fields.next().unwrap_or_default().to_owned();
    Ok(CommitDetail {
        hash: next(),
        author: next(),
        timestamp: next().parse().unwrap_or_default(),
        subject: next(),
        body: next().trim_end().into(),
    })
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub hash: String,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
    pub line: usize,
    pub content: String,
    pub block: bool,
}
pub async fn blame(repo: &Repo, path: &str) -> Result<Vec<Blame>> {
    repo.path(path)?;
    let output = git::run(
        &repo.root,
        &["blame", "--line-porcelain", git::HEAD, "--", path],
        None,
    )
    .await?;
    if blames_nothing(&output) {
        return Ok(Vec::new());
    }
    let mut result: Vec<Blame> = Vec::new();
    let text = output.accept(&[git::EXIT_SUCCESS])?.text();
    let mut header = BlameHeader::default();
    for value in text.lines() {
        let Some(content) = value.strip_prefix('\t') else {
            header.read(value);
            continue;
        };
        let block = result.last().is_none_or(|last| last.hash != header.hash);
        result.push(header.entry(content, block));
    }
    Ok(result)
}
const MISSING_BLAME_TARGETS: [&str; 2] = ["no such ref", "no such path"];
fn blames_nothing(output: &git::Output) -> bool {
    let message = output.message();
    let missing_target = MISSING_BLAME_TARGETS
        .iter()
        .any(|sign| message.contains(sign));
    output.code == git::EXIT_FATAL && missing_target
}
#[derive(Default)]
struct BlameHeader {
    hash: String,
    author: String,
    timestamp: i64,
    subject: String,
    line: usize,
}
struct CommitLine {
    hash: String,
    line: usize,
}
fn is_full_hash(value: &str) -> bool {
    value.len() == git::FULL_HASH_LENGTH
        && value.chars().all(|character| character.is_ascii_hexdigit())
}
fn parse_commit_line(value: &str) -> Option<CommitLine> {
    let mut parts = value.split_whitespace();
    let hash = parts.next()?;
    let _original = parts.next()?;
    let line = parts.next()?;
    if !is_full_hash(hash) {
        return None;
    }
    Some(CommitLine {
        hash: hash.into(),
        line: line.parse().unwrap_or_default(),
    })
}
impl BlameHeader {
    fn read(&mut self, value: &str) {
        if let Some(author) = value.strip_prefix("author ") {
            self.author = author.into();
            return;
        }
        if let Some(time) = value.strip_prefix("author-time ") {
            self.timestamp = time.parse().unwrap_or_default();
            return;
        }
        if let Some(summary) = value.strip_prefix("summary ") {
            self.subject = summary.into();
            return;
        }
        if let Some(commit) = parse_commit_line(value) {
            self.hash = commit.hash;
            self.line = commit.line;
        }
    }
    fn entry(&self, content: &str, block: bool) -> Blame {
        Blame {
            hash: self.hash.clone(),
            author: self.author.clone(),
            timestamp: self.timestamp,
            subject: self.subject.clone(),
            line: self.line,
            content: content.into(),
            block,
        }
    }
}
