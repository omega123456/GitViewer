use crate::{
    error::{Error, Result},
    git,
    status::{self, Status},
    worktree,
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
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
    pub project: PathBuf,
    status: Mutex<Arc<Status>>,
    pub stale: Arc<AtomicBool>,
    pub history_stale: Arc<AtomicBool>,
    pub writes: Mutex<()>,
    pub histories: Mutex<HashMap<String, crate::history::Session>>,
    pub watchers: std::sync::Mutex<Vec<crate::watch::Watcher>>,
    pub directory_reads: AtomicUsize,
    pub untracked_lines: std::sync::Mutex<HashMap<String, crate::lines::Counted>>,
}
pub struct Reread {
    pub status: Arc<Status>,
    pub changed: bool,
    pub moved: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub id: String,
    pub name: String,
    pub root: String,
    pub project: String,
    pub status: Status,
}
impl Registry {
    pub async fn open(&self, path: &str) -> Result<Info> {
        if !git::detect::environment().await.supported {
            return Err(Error::new("missing_git", "Git 2.38 or newer is required"));
        }
        let output = git::run(
            Path::new(path),
            &[
                "rev-parse",
                "--path-format=absolute",
                "--show-toplevel",
                "--git-dir",
                "--git-common-dir",
            ],
            None,
        )
        .await?
        .accept(&[0])
        .map_err(|e| Error::new("invalid_repository", e.message))?;
        let text = output.text();
        let mut lines = text.lines().map(str::trim);
        let root = std::fs::canonicalize(lines.next().unwrap_or_default())?;
        let id = root.to_string_lossy().into_owned();
        let existing = self.repos.lock().await.get(&id).cloned();
        if let Some(repo) = existing {
            return Ok(repo.info().await);
        }
        let git_dir = worktree::canonical(lines.next().unwrap_or_default());
        let common_dir = worktree::canonical(lines.next().unwrap_or_default());
        let project = worktree::list(&root)
            .await?
            .into_iter()
            .next()
            .map(|main| PathBuf::from(main.id))
            .unwrap_or_default();
        let repo = Arc::new(Repo {
            git_dir,
            common_dir,
            project,
            ..Repo::new(root)
        });
        repo.refresh().await?;
        let winner = self.repos.lock().await.entry(id).or_insert(repo).clone();
        Ok(winner.info().await)
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
            git_dir: root.join(".git"),
            common_dir: root.join(".git"),
            project: root.clone(),
            root,
            status: Mutex::new(Arc::default()),
            stale: Arc::new(AtomicBool::new(true)),
            history_stale: Arc::new(AtomicBool::new(false)),
            writes: Mutex::new(()),
            histories: Mutex::new(HashMap::new()),
            watchers: std::sync::Mutex::new(Vec::new()),
            directory_reads: AtomicUsize::new(0),
            untracked_lines: std::sync::Mutex::new(HashMap::new()),
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
            project: self.project.to_string_lossy().into_owned(),
            status: Status::clone(&*self.status.lock().await),
        }
    }
    async fn read(&self, status: &mut Arc<Status>) -> Result<Reread> {
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
        let next = match read {
            Ok(next) => next,
            Err(error) => {
                self.stale.store(true, Ordering::SeqCst);
                return Err(error);
            }
        };
        let previous = std::mem::replace(status, Arc::new(next));
        let moved = (&previous.oid, &previous.branch) != (&status.oid, &status.branch);
        if moved {
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
                Arc::make_mut(status).merging = Some(
                    name.strip_prefix("remotes/")
                        .unwrap_or(name.as_str())
                        .to_owned(),
                );
            }
        }
        Ok(Reread {
            changed: previous != *status,
            moved,
            status: status.clone(),
        })
    }
    pub async fn reread(&self) -> Result<Reread> {
        let mut status = self.status.lock().await;
        self.read(&mut status).await
    }
    pub async fn refresh(&self) -> Result<Arc<Status>> {
        Ok(self.reread().await?.status)
    }
    pub async fn snapshot(&self) -> Result<Arc<Status>> {
        let mut status = self.status.lock().await;
        if self.stale.load(Ordering::SeqCst) {
            return Ok(self.read(&mut status).await?.status);
        }
        Ok(status.clone())
    }
    pub async fn writable(&self) -> Result<Arc<Status>> {
        let status = self.refresh().await?;
        if status.conflicted {
            return Err(Error::refused(
                "Resolve existing conflicts in a terminal before changing this repository",
            ));
        }
        Ok(status)
    }
    pub fn path(&self, relative: &str) -> Result<PathBuf> {
        let full = self.root.join(inside(relative)?);
        let mut ancestor = full.as_path();
        while !ancestor.exists() {
            ancestor = ancestor
                .parent()
                .ok_or_else(|| Error::refused("Invalid path"))?;
        }
        contained(&self.root, &std::fs::canonicalize(ancestor)?)?;
        Ok(full)
    }
    pub fn paths(&self) -> Paths<'_> {
        Paths {
            repo: self,
            directories: HashMap::new(),
        }
    }
}
fn inside(relative: &str) -> Result<&Path> {
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
    Ok(path)
}
fn contained(root: &Path, resolved: &Path) -> Result<()> {
    if resolved.starts_with(root) {
        Ok(())
    } else {
        Err(Error::refused("Symlink points outside the repository"))
    }
}
pub struct Paths<'a> {
    repo: &'a Repo,
    directories: HashMap<PathBuf, PathBuf>,
}
impl Paths<'_> {
    fn directory(&mut self, path: &Path) -> Result<PathBuf> {
        if let Some(resolved) = self.directories.get(path) {
            return Ok(resolved.clone());
        }
        let resolved = std::fs::canonicalize(path)?;
        self.directories
            .insert(path.to_path_buf(), resolved.clone());
        Ok(resolved)
    }
    pub fn resolve(&mut self, relative: &str) -> Result<PathBuf> {
        let full = self.repo.root.join(inside(relative)?);
        let linked = std::fs::symlink_metadata(&full)
            .is_ok_and(|metadata| metadata.file_type().is_symlink());
        let (Some(parent), Some(name)) = (full.parent(), full.file_name()) else {
            return self.repo.path(relative);
        };
        if linked {
            return self.repo.path(relative);
        }
        let resolved = if full.exists() {
            self.directory(parent)?.join(name)
        } else {
            let mut ancestor = parent;
            while !ancestor.exists() {
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| Error::refused("Invalid path"))?;
            }
            self.directory(ancestor)?
        };
        contained(&self.repo.root, &resolved)?;
        Ok(full)
    }
}
