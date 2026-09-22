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
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;

pub type Repository = Arc<Mutex<Repo>>;
#[derive(Default)]
pub struct Registry {
    pub repos: Mutex<HashMap<String, Repository>>,
}
pub struct Repo {
    pub root: PathBuf,
    pub status: Status,
    pub stale: Arc<AtomicBool>,
    pub history_stale: Arc<AtomicBool>,
    pub watchers: Vec<crate::watch::Watcher>,
    pub directory_reads: usize,
    pub histories: HashMap<String, crate::history::Session>,
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
            return Ok(repo.lock().await.info());
        }
        let mut repo = Repo {
            root,
            status: Status::default(),
            stale: Arc::new(AtomicBool::new(true)),
            history_stale: Arc::new(AtomicBool::new(false)),
            watchers: Vec::new(),
            directory_reads: 0,
            histories: HashMap::new(),
        };
        repo.refresh().await?;
        let info = repo.info();
        repos.insert(id, Arc::new(Mutex::new(repo)));
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
    pub fn info(&self) -> Info {
        Info {
            id: self.root.to_string_lossy().into_owned(),
            name: self
                .root
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            root: self.root.to_string_lossy().into_owned(),
            status: self.status.clone(),
        }
    }
    pub async fn refresh(&mut self) -> Result<Status> {
        let previous = (self.status.oid.clone(), self.status.branch.clone());
        self.status = status::parse(
            &git::run(
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
            .await?
            .accept(&[0])?
            .bytes,
        )?;
        if self.status.conflicted {
            let named = git::run(
                &self.root,
                &["name-rev", "--name-only", "--always", "MERGE_HEAD"],
                None,
            )
            .await?
            .accept(&[0, 128])?;
            let name = named.text().trim().to_owned();
            if named.code == 0 && !name.is_empty() {
                self.status.merging = Some(
                    name.strip_prefix("remotes/")
                        .unwrap_or(name.as_str())
                        .to_owned(),
                );
            }
        }
        if self.history_stale.swap(false, Ordering::SeqCst)
            || previous != (self.status.oid.clone(), self.status.branch.clone())
        {
            self.histories.clear();
        }
        self.stale.store(false, Ordering::SeqCst);
        Ok(self.status.clone())
    }
    pub async fn snapshot(&mut self) -> Result<Status> {
        if self.stale.load(Ordering::SeqCst) {
            self.refresh().await?;
        }
        Ok(self.status.clone())
    }
    pub async fn writable(&mut self) -> Result<()> {
        if self.refresh().await?.conflicted {
            return Err(Error::refused(
                "Resolve existing conflicts in a terminal before changing this repository",
            ));
        }
        Ok(())
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
