use crate::{
    diff::resolve,
    error::{Error, Result},
    fs, git,
    repo::{Paths, Repo},
    status::{Entry, Status},
    variant,
};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilesAction {
    Stage,
    Unstage,
    Revert,
    Discard,
}
impl FilesAction {
    pub fn parse(name: &str) -> Result<Self> {
        variant::parse(name, "Unknown file action")
    }
    fn follows_renames(self) -> bool {
        matches!(self, Self::Unstage | Self::Revert)
    }
}
struct Targets<'a> {
    repo: &'a Repo,
    status: &'a Status,
    requested: &'a [String],
    entries: HashMap<&'a str, &'a Entry>,
    selected: Vec<String>,
    checked: Paths<'a>,
}
impl Targets<'_> {
    fn selected(&self) -> impl Iterator<Item = &str> {
        self.selected.iter().map(String::as_str)
    }
    fn index_of(&self, path: &str) -> Option<&str> {
        self.entries.get(path).map(|entry| entry.index())
    }
    fn include_rename_sources(&mut self) {
        let mut chosen: HashSet<&str> = self.requested.iter().map(String::as_str).collect();
        for path in self.requested {
            let original = self
                .entries
                .get(path.as_str())
                .and_then(|entry| entry.original_path());
            if let Some(original) = original.filter(|original| chosen.insert(original)) {
                self.selected.push(original.into());
            }
        }
    }
}
async fn stage(targets: &Targets<'_>) -> Result<()> {
    git::run_with_pathspec(&targets.repo.root, &["add"], targets.selected()).await?;
    Ok(())
}
async fn unstage(targets: &Targets<'_>) -> Result<()> {
    let unborn = targets.status.oid == "(initial)";
    let arguments = if unborn {
        vec!["rm", "--cached", "--force", "--ignore-unmatch"]
    } else {
        vec!["restore", "--staged"]
    };
    git::run_with_pathspec(&targets.repo.root, &arguments, targets.selected()).await?;
    Ok(())
}
async fn revert(targets: &mut Targets<'_>) -> Result<()> {
    let (added, tracked): (Vec<&String>, Vec<&String>) = targets
        .selected
        .iter()
        .partition(|path| matches!(targets.index_of(path), Some(git::UNTRACKED | "A")));
    if !tracked.is_empty() {
        git::run_with_pathspec(
            &targets.repo.root,
            &["restore", "--source=HEAD", "--staged", "--worktree"],
            tracked.iter().map(|path| path.as_str()),
        )
        .await?;
    }
    let indexed: Vec<&String> = added
        .iter()
        .copied()
        .filter(|path| targets.index_of(path) == Some("A"))
        .collect();
    if !indexed.is_empty() {
        git::run_with_pathspec(
            &targets.repo.root,
            &["rm", "--cached", "--force"],
            indexed.iter().map(|path| path.as_str()),
        )
        .await?;
    }
    for path in added {
        fs::remove_if_present(&targets.checked.resolve(path)?)?;
    }
    Ok(())
}
async fn discard(targets: &Targets<'_>) -> Result<()> {
    let untracked_requested = targets
        .requested
        .iter()
        .any(|path| targets.index_of(path) == Some(git::UNTRACKED));
    if untracked_requested {
        return Err(Error::refused(
            "Untracked files cannot be recovered by Git; discard them in your file manager",
        ));
    }
    git::run_with_pathspec(
        &targets.repo.root,
        &["restore", "--worktree"],
        targets.selected(),
    )
    .await?;
    Ok(())
}
pub async fn files(repo: &Repo, paths: &[String], action: FilesAction) -> Result<()> {
    let status = repo.writable().await?;
    if paths.is_empty() {
        return Err(Error::refused("Select a file first"));
    }
    let mut checked = repo.paths();
    for path in paths {
        checked.resolve(path)?;
    }
    let mut targets = Targets {
        repo,
        status: &status,
        requested: paths,
        entries: status
            .entries
            .iter()
            .map(|entry| (entry.path(), entry))
            .collect(),
        selected: paths.to_vec(),
        checked,
    };
    if action.follows_renames() {
        targets.include_rename_sources();
    }
    match action {
        FilesAction::Stage => stage(&targets).await,
        FilesAction::Unstage => unstage(&targets).await,
        FilesAction::Revert => revert(&mut targets).await,
        FilesAction::Discard => discard(&targets).await,
    }
}
pub async fn commit(repo: &Repo, message: &str) -> Result<String> {
    repo.writable().await?;
    if message.trim().is_empty() {
        return Err(Error::refused("Write a commit message first"));
    }
    let nothing_staged = git::succeeded(&repo.root, &["diff", "--cached", "--quiet"]).await?;
    if nothing_staged {
        return Err(Error::refused("Nothing is staged"));
    }
    git::run(
        &repo.root,
        &["commit", "--file=-"],
        Some(message.as_bytes()),
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?;
    resolve(repo, git::HEAD).await
}
