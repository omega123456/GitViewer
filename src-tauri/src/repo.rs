use crate::{
    error::{Error, Result},
    git,
    status::{self, Status},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;

pub type Repository = Arc<Repo>;
#[derive(Default)]
pub struct Registry {
    pub repos: Mutex<HashMap<String, Repository>>,
}
pub struct Repo {
    pub root: PathBuf,
    status: Mutex<Status>,
    pub stale: Arc<AtomicBool>,
    pub history_stale: Arc<AtomicBool>,
    pub writes: Mutex<()>,
    pub histories: Mutex<HashMap<String, crate::history::Session>>,
    pub watchers: std::sync::Mutex<Vec<crate::watch::Watcher>>,
    pub directory_reads: AtomicUsize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub id: String,
    pub name: String,
    pub root: String,
    pub status: Status,
}
impl Registry {
    pub async fn open(&self, path: &str) -> Result<Info> {
        if !git::detect::environment().await.supported {
            return Err(Error::new("missing_git", "Git 2.38 or newer is required"));
        }
        let output = git::run(Path::new(path), &["rev-parse", "--show-toplevel"], None)
            .await?
            .accept(&[0])
            .map_err(|e| Error::new("invalid_repository", e.message))?;
        let root = std::fs::canonicalize(output.text().trim())?;
        let id = root.to_string_lossy().into_owned();
        let mut repos = self.repos.lock().await;
        if let Some(repo) = repos.get(&id) {
            return Ok(repo.info().await);
        }
        let repo = Repo::new(root);
        repo.refresh().await?;
        let info = repo.info().await;
        repos.insert(id, Arc::new(repo));
        Ok(info)
    }
    pub async fn get(&self, id: &str) -> Result<Repository> {
        self.repos
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| Error::new("invalid_repository", "Repository is not open"))
    }
}
impl Repo {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            status: Mutex::new(Status::default()),
            stale: Arc::new(AtomicBool::new(true)),
            history_stale: Arc::new(AtomicBool::new(false)),
            writes: Mutex::new(()),
            histories: Mutex::new(HashMap::new()),
            watchers: std::sync::Mutex::new(Vec::new()),
            directory_reads: AtomicUsize::new(0),
        }
    }
    pub async fn info(&self) -> Info {
        Info {
            id: self.root.to_string_lossy().into_owned(),
            name: self
                .root
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            root: self.root.to_string_lossy().into_owned(),
            status: self.status.lock().await.clone(),
        }
    }
    async fn read(&self, status: &mut Status) -> Result<Status> {
        let previous = (status.oid.clone(), status.branch.clone());
        self.stale.store(false, Ordering::SeqCst);
        let read = git::run(
            &self.root,
            &[
                "status",
                "--porcelain=v2",
                "-z",
                "-b",
                "--untracked-files=all",
            ],
            None,
        )
        .await
        .and_then(|output| output.accept(&[0]))
        .and_then(|output| status::parse(&output.bytes));
        *status = match read {
            Ok(status) => status,
            Err(error) => {
                self.stale.store(true, Ordering::SeqCst);
                return Err(error);
            }
        };
        if previous != (status.oid.clone(), status.branch.clone()) {
            self.history_stale.store(true, Ordering::SeqCst);
        }
        if status.conflicted {
            let named = git::run(
                &self.root,
                &["name-rev", "--name-only", "--always", "MERGE_HEAD"],
                None,
            )
            .await?
            .accept(&[0, 128])?;
            let name = named.text().trim().to_owned();
            if named.code == 0 && !name.is_empty() {
                status.merging = Some(
                    name.strip_prefix("remotes/")
                        .unwrap_or(name.as_str())
                        .to_owned(),
                );
            }
        }
        Ok(status.clone())
    }
    pub async fn refresh(&self) -> Result<Status> {
        let mut status = self.status.lock().await;
        self.read(&mut status).await
    }
    pub async fn snapshot(&self) -> Result<Status> {
        let mut status = self.status.lock().await;
        if self.stale.load(Ordering::SeqCst) {
            return self.read(&mut status).await;
        }
        Ok(status.clone())
    }
    pub async fn writable(&self) -> Result<Status> {
        let status = self.refresh().await?;
        if status.conflicted {
            return Err(Error::refused(
                "Resolve existing conflicts in a terminal before changing this repository",
            ));
        }
        Ok(status)
    }
    pub fn path(&self, relative: &str) -> Result<PathBuf> {
        let path = Path::new(relative);
        if path.is_absolute()
            || path
                .components()
                .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
            || path
                .components()
                .any(|c| c.as_os_str().to_string_lossy().eq_ignore_ascii_case(".git"))
        {
            return Err(Error::refused("Path must stay within the working tree"));
        }
        let full = self.root.join(path);
        let mut ancestor = full.as_path();
        while !ancestor.exists() {
            ancestor = ancestor
                .parent()
                .ok_or_else(|| Error::refused("Invalid path"))?;
        }
        if !std::fs::canonicalize(ancestor)?.starts_with(&self.root) {
            return Err(Error::refused("Symlink points outside the repository"));
        }
        Ok(full)
    }
}
