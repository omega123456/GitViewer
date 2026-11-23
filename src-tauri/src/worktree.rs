use crate::{
    error::{Error, Result},
    fs, git,
    repo::Repo,
    stash,
    status::Entry,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
};

const RECORD_SEPARATOR: &str = "\0\0";
const MIN_OBJECT_ID_LENGTH: usize = 4;
const MAX_FORCE: u64 = 2;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub name: String,
    pub main: bool,
    pub bare: bool,
    pub branch: String,
    pub oid: String,
    pub detached: bool,
    pub locked: Option<String>,
    pub prunable: bool,
    pub missing: bool,
}

pub fn canonical(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

fn parse(main: bool, record: &str) -> Worktree {
    let mut worktree = Worktree {
        main,
        ..Worktree::default()
    };
    for line in record.split(git::NUL) {
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "worktree" => {
                let path = canonical(value);
                worktree.missing = !path.exists();
                worktree.name = fs::file_name_of(&path);
                worktree.id = path.to_string_lossy().into_owned();
            }
            "HEAD" => worktree.oid = value.into(),
            "branch" => worktree.branch = value.trim_start_matches("refs/heads/").into(),
            "detached" => worktree.detached = true,
            "bare" => worktree.bare = true,
            "locked" => worktree.locked = Some(value.into()),
            _ => worktree.prunable |= key == "prunable",
        }
    }
    worktree
}

pub async fn list(root: &Path) -> Result<Vec<Worktree>> {
    let text = git::text(root, &["worktree", "list", "--porcelain", "-z"]).await?;
    Ok(text
        .split(RECORD_SEPARATOR)
        .filter(|record| !record.is_empty())
        .enumerate()
        .map(|(index, record)| parse(index == 0, record))
        .collect())
}

pub async fn prune(root: &Path) -> Result<()> {
    git::text(root, &["worktree", "prune"]).await?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct Target {
    pub path: String,
    pub free: bool,
    pub label: String,
}
#[derive(Debug, Serialize)]
pub struct Summary {
    pub ahead: u32,
    pub orphans: u32,
    pub submodules: bool,
}
#[derive(Debug, Serialize)]
pub struct Applied {
    pub base: String,
    pub tree: String,
    pub files: usize,
    pub conflicts: usize,
}

fn reference(name: &str) -> Result<&str> {
    if name.is_empty() || name.starts_with('-') {
        return Err(Error::refused(format!("Invalid reference: {name}")));
    }
    Ok(name)
}
fn object(id: &str) -> Result<&str> {
    if id.len() < MIN_OBJECT_ID_LENGTH || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(Error::refused(format!("Invalid object: {id}")));
    }
    Ok(id)
}
fn free(path: &Path) -> bool {
    std::fs::read_dir(path).map_or(!path.exists(), |mut entries| entries.next().is_none())
}
async fn remote(root: &Path, name: &str) -> Result<bool> {
    let local = git::ref_exists(root, &git::local_branch(name)).await?;
    Ok(!local && git::ref_exists(root, &git::remote_branch(name)).await?)
}
async fn label(repo: &Repo, mode: &str, name: &str) -> Result<String> {
    if name.is_empty() {
        return Ok("worktree".into());
    }
    let name = reference(name)?;
    if mode == "detached" {
        return Ok(
            git::text(&repo.root, &["rev-parse", "--short", "--verify", name])
                .await?
                .trim()
                .into(),
        );
    }
    let branch = if mode == "existing" && remote(&repo.root, name).await? {
        git::without_remote(name)
    } else {
        name
    };
    Ok(branch.replace('/', "-"))
}
pub async fn target(repo: &Repo, mode: &str, name: &str, path: &str) -> Result<Target> {
    let label = label(repo, mode, name).await?;
    if !path.is_empty() {
        return Ok(Target {
            free: free(Path::new(path)),
            path: path.into(),
            label,
        });
    }
    let stem = format!("{}-{label}", fs::file_name_of(&repo.project));
    let parent = repo.project.parent().unwrap_or(&repo.project);
    let path = (1..)
        .map(|number| match number {
            1 => parent.join(&stem),
            _ => parent.join(format!("{stem}-{number}")),
        })
        .find(|candidate| free(candidate))
        .unwrap_or_default();
    Ok(Target {
        path: path.to_string_lossy().into_owned(),
        free: true,
        label,
    })
}
pub async fn add(repo: &Repo, path: &str, mode: &str, branch: &str, base: &str) -> Result<String> {
    if !Path::new(path).is_absolute() {
        return Err(Error::refused("Choose an absolute folder for the worktree"));
    }
    let mut arguments = vec!["worktree", "add"];
    match mode {
        "detached" => arguments.extend(["--detach", path, reference(base)?]),
        "new" => arguments.extend(["-b", reference(branch)?, path, reference(base)?]),
        _ if remote(&repo.root, reference(branch)?).await? => {
            arguments.extend(["--track", "-b", git::without_remote(branch), path, branch])
        }
        _ => arguments.extend([path, branch]),
    }
    git::run(&repo.root, &arguments, None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(canonical(path).to_string_lossy().into_owned())
}
async fn count(root: &Path, arguments: &[&str]) -> Result<u32> {
    Ok(git::text(root, arguments)
        .await?
        .trim()
        .parse()
        .unwrap_or_default())
}
pub async fn summary(source: &Repo, target: &str) -> Result<Summary> {
    let detached = source.snapshot().await?.branch == git::DETACHED_LABEL;
    Ok(Summary {
        ahead: count(
            &source.root,
            &[
                "rev-list",
                "--count",
                &git::range(object(target)?, git::HEAD),
            ],
        )
        .await?,
        orphans: if detached {
            count(
                &source.root,
                &[
                    "rev-list",
                    "--count",
                    git::HEAD,
                    "--not",
                    "--branches",
                    "--tags",
                    "--remotes",
                ],
            )
            .await?
        } else {
            0
        },
        submodules: source.root.join(".gitmodules").exists(),
    })
}
pub async fn remove(repo: &Repo, worktree: &str, force: u64) -> Result<()> {
    let mut arguments = vec!["worktree", "remove"];
    let repeats = usize::try_from(force.min(MAX_FORCE)).unwrap_or_default();
    arguments.extend(std::iter::repeat_n("--force", repeats));
    arguments.push(worktree);
    git::run(&repo.root, &arguments, None)
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
async fn snapshot(source: &Repo) -> Result<String> {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let index = std::env::temp_dir().join(format!(
        "gitviewer-index-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    let real = source.git_dir.join("index");
    let tree = async {
        if real.exists() {
            std::fs::copy(&real, &index)?;
        }
        git::run_indexed(&source.root, &index, &["add", "-A"])
            .await?
            .accept(&[git::EXIT_SUCCESS])?;
        Ok::<_, Error>(
            git::run_indexed(&source.root, &index, &["write-tree"])
                .await?
                .accept(&[git::EXIT_SUCCESS])?
                .text()
                .trim()
                .to_string(),
        )
    }
    .await;
    let _ = std::fs::remove_file(&index);
    tree
}
async fn patch(root: &Path, base: &str, tree: &str) -> Result<Vec<u8>> {
    Ok(git::run(
        root,
        &[
            "diff-tree",
            "-r",
            "-p",
            "--binary",
            "--full-index",
            "--no-renames",
            object(base)?,
            object(tree)?,
        ],
        None,
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?
    .bytes)
}
async fn changed(root: &Path, base: &str, tree: &str) -> Result<HashSet<String>> {
    Ok(git::nul_list(
        root,
        &[
            "diff-tree",
            "-r",
            "--name-only",
            "-z",
            "--no-renames",
            base,
            tree,
        ],
    )
    .await?
    .into_iter()
    .collect())
}
fn apply_arguments<'flag>(flags: &[&'flag str]) -> Vec<&'flag str> {
    let mut arguments = vec!["apply", "--binary", "--whitespace=nowarn"];
    arguments.extend_from_slice(flags);
    arguments
}
async fn patched(root: &Path, flags: &[&str], patch: &[u8]) -> Result<git::Output> {
    git::run(root, &apply_arguments(flags), Some(patch)).await
}
async fn patched_cleanly(root: &Path, flags: &[&str], patch: &[u8]) -> Result<bool> {
    Ok(git::apply_checked(root, &apply_arguments(flags), patch)
        .await?
        .succeeded())
}
async fn unstage(target: &Repo, paths: &HashSet<String>) -> Result<()> {
    git::run_with_pathspec(
        &target.root,
        &["restore", "--staged"],
        paths.iter().map(String::as_str),
    )
    .await?;
    Ok(())
}
async fn merged(target: &Repo, patch: &[u8], temporary: &str) -> Result<()> {
    let applied = patched_cleanly(&target.root, &["--index"], patch).await?
        || patched(&target.root, &["--3way"], patch).await?.succeeded();
    if !applied {
        return Err(Error::refused("The worktree's changes conflict with main."));
    }
    for flags in [&["--index"][..], &[]] {
        let mut arguments = vec!["stash", "apply"];
        arguments.extend_from_slice(flags);
        arguments.push(temporary);
        if git::run(&target.root, &arguments, None).await?.succeeded() {
            return Ok(());
        }
        if target.refresh().await?.conflicted {
            break;
        }
    }
    Err(Error::refused(
        "Your changes in main conflict with the worktree's changes.",
    ))
}
async fn stashed(target: &Repo, patch: &[u8], paths: &HashSet<String>) -> Result<()> {
    let temporary = stash::save(target, "GitViewer: apply worktree").await?;
    let Err(error) = merged(target, patch, &temporary).await else {
        stash::remove(target, &temporary).await?;
        return unstage(target, paths).await;
    };
    git::run(
        &target.root,
        &["reset", "--hard", "--quiet", git::HEAD],
        None,
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])?;
    for path in stash::untracked(target, &temporary).await? {
        let _ = std::fs::remove_file(target.path(&path)?);
    }
    stash::restore(target, &temporary)
        .await
        .map_err(|failure| {
            Error::unexpected(format!(
                "Changes remain recoverable in stash {temporary}. {}",
                failure.message
            ))
        })?;
    stash::remove(target, &temporary).await?;
    Err(Error::refused(format!(
        "Main was left as it was. {}",
        error.message
    )))
}
pub async fn apply(source: &Repo, target: &Repo, smart: bool) -> Result<Applied> {
    let status = target.writable().await?;
    let tree = snapshot(source).await?;
    let base = git::run(
        &source.root,
        &["merge-base", git::HEAD, object(&status.oid)?],
        None,
    )
    .await?
    .accept(&[git::EXIT_SUCCESS])
    .map_err(|_| Error::refused("This worktree shares no history with main"))?
    .text()
    .trim()
    .to_string();
    let paths = changed(&source.root, &base, &tree).await?;
    let mut applied = Applied {
        files: paths.len(),
        conflicts: 0,
        base,
        tree,
    };
    if paths.is_empty() {
        return Ok(applied);
    }
    let patch = patch(&source.root, &applied.base, &applied.tree).await?;
    let overlap = stash::overlapping(&status, &paths);
    if !overlap.is_empty() {
        if !smart {
            return Err(Error::new(
                "overlap",
                format!("Main has changes to:\n{}", overlap.join("\n")),
            ));
        }
        stashed(target, &patch, &paths).await?;
        return Ok(applied);
    }
    if patched_cleanly(&target.root, &[], &patch).await? {
        return Ok(applied);
    }
    let output = patched(&target.root, &["--3way"], &patch)
        .await?
        .accept(&git::SUCCESS_OR_DIFFERENT)?;
    applied.conflicts = target
        .refresh()
        .await?
        .entries
        .iter()
        .filter(|entry| matches!(entry, Entry::Unmerged { .. }))
        .count();
    if applied.conflicts == 0 {
        if !output.succeeded() {
            return Err(Error::git(output.message()));
        }
        unstage(target, &paths).await?;
    }
    Ok(applied)
}
pub async fn unapply(target: &Repo, base: &str, tree: &str) -> Result<()> {
    target.writable().await?;
    let patch = patch(&target.root, base, tree).await?;
    if !patched_cleanly(&target.root, &["-R"], &patch).await? {
        return Err(Error::refused(
            "Main changed since the apply. Undo it by hand.",
        ));
    }
    Ok(())
}
