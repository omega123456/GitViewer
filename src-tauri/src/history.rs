use crate::{
    diff::resolve,
    error::{Error, Result},
    git,
    graph::{lanes, Commit, Lane},
    lines::{numstat, Lines},
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
    stderr: Option<tokio::task::JoinHandle<std::io::Result<String>>>,
    lanes: Vec<Lane>,
    kept: Option<(String, Page)>,
    next: String,
}
impl Session {
    fn start(repo: &Repo, path: &str) -> Result<Self> {
        let mut args = vec![
            "log",
            "--date-order",
            "--format=%H%x00%P%x00%an%x00%at%x00%D%x00%s%x00",
        ];
        if !path.is_empty() {
            args.extend(["--", path]);
        }
        let mut child = git::command("git", &repo.root, &args).spawn()?;
        child.stdin.take();
        let stdout = child
            .stdout
            .take()
            .ok_or(Error::new("unexpected", "History stdout unavailable"))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or(Error::new("unexpected", "History stderr unavailable"))?;
        let stderr = tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut text = String::new();
            stderr.read_to_string(&mut text).await?;
            Ok(text)
        });
        Ok(Self {
            child,
            reader: tokio::io::BufReader::new(stdout),
            stderr: Some(stderr),
            lanes: Vec::new(),
            kept: None,
            next: String::new(),
        })
    }
    async fn page(&mut self, cursor: &str) -> Result<Page> {
        use tokio::io::AsyncBufReadExt;
        if let Some((_, page)) = self.kept.as_ref().filter(|(kept, _)| kept == cursor) {
            return Ok(page.clone());
        }
        if cursor != self.next {
            return Err(Error::refused(
                "History changed; reload from the first page",
            ));
        }
        let mut commits = Vec::new();
        let mut eof = false;
        while commits.len() < 100 {
            let mut fields = Vec::new();
            for _ in 0..6 {
                let mut bytes = Vec::new();
                let count = self.reader.read_until(0, &mut bytes).await?;
                if count == 0 || (fields.is_empty() && bytes.iter().all(u8::is_ascii_whitespace)) {
                    eof = true;
                    break;
                }
                if bytes.last() == Some(&0) {
                    bytes.pop();
                }
                fields.push(String::from_utf8_lossy(&bytes).into_owned());
            }
            if eof {
                break;
            }
            commits.push(Commit {
                hash: fields[0].trim().into(),
                parents: fields[1].split_whitespace().map(String::from).collect(),
                author: fields[2].clone(),
                timestamp: fields[3].parse().unwrap_or_default(),
                refs: fields[4].clone(),
                subject: fields[5].clone(),
                lane: 0,
                color: 0,
                entered: false,
                segments: Vec::new(),
            });
        }
        if eof {
            let code = self.child.wait().await?;
            let stderr = match self.stderr.take() {
                Some(task) => task.await.map_err(Error::from)??,
                None => String::new(),
            };
            let unborn =
                code.code() == Some(128) && stderr.contains("does not have any commits yet");
            if !code.success() && !unborn {
                return Err(Error::git(stderr));
            }
        }
        lanes(&mut commits, &mut self.lanes);
        let next = if eof {
            None
        } else {
            commits.last().map(|c| c.hash.clone())
        };
        self.next = next.clone().unwrap_or_default();
        let page = Page {
            commits,
            cursor: next,
        };
        self.kept = Some((cursor.into(), page.clone()));
        Ok(page)
    }
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
    let mut args = vec![
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--raw",
        "--numstat",
        "-r",
        "-z",
    ];
    if let Some(parent) = parent {
        args.push(parent);
    }
    args.push(&sha);
    let output = git::text(&repo.root, &args).await?;
    let mut files = CommitFiles::default();
    let mut fields = output.split('\0');
    let mut counts = String::new();
    while let Some(field) = fields.next() {
        if let Some(raw) = field.strip_prefix(':') {
            let letter = raw.rsplit(' ').next().unwrap_or_default();
            let path = fields.next().unwrap_or_default();
            files
                .statuses
                .insert(path.to_owned(), letter.chars().take(1).collect());
        } else {
            counts.push_str(field);
            counts.push('\0');
        }
    }
    files.lines = numstat(&counts);
    Ok(files)
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub hash: String,
    pub author: String,
    pub timestamp: i64,
    pub line: usize,
    pub content: String,
    pub block: bool,
}
pub async fn blame(repo: &Repo, path: &str) -> Result<Vec<Blame>> {
    repo.path(path)?;
    let output = git::run(
        &repo.root,
        &["blame", "--line-porcelain", "HEAD", "--", path],
        None,
    )
    .await?;
    if output.code == 128
        && ["no such ref", "no such path"]
            .iter()
            .any(|v| output.message().contains(v))
    {
        return Ok(Vec::new());
    }
    let mut result: Vec<Blame> = Vec::new();
    let text = output.accept(&[0])?.text();
    let mut hash = String::new();
    let mut author = String::new();
    let mut timestamp = 0;
    let mut line = 0;
    for value in text.lines() {
        if let Some(content) = value.strip_prefix('\t') {
            let block = result.last().is_none_or(|b| b.hash != hash);
            result.push(Blame {
                hash: hash.clone(),
                author: author.clone(),
                timestamp,
                line,
                content: content.into(),
                block,
            });
        } else if let Some(value) = value.strip_prefix("author ") {
            author = value.into();
        } else if let Some(value) = value.strip_prefix("author-time ") {
            timestamp = value.parse().unwrap_or_default();
        } else {
            let parts: Vec<&str> = value.split_whitespace().collect();
            if parts.len() >= 3
                && parts[0].len() == 40
                && parts[0].chars().all(|c| c.is_ascii_hexdigit())
            {
                hash = parts[0].into();
                line = parts[2].parse().unwrap_or_default();
            }
        }
    }
    Ok(result)
}
