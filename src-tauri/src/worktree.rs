use crate::{
    error::{Error, Result},
    git,
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
    for line in record.split('\0') {
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "worktree" => {
                let path = canonical(value);
                worktree.missing = !path.exists();
                worktree.name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
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
        .split("\0\0")
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
    if id.len() < 4 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(Error::refused(format!("Invalid object: {id}")));
    }
    Ok(id)
}
fn free(path: &Path) -> bool {
    std::fs::read_dir(path).map_or(!path.exists(), |mut entries| entries.next().is_none())
}
async fn remote(root: &Path, name: &str) -> Result<bool> {
    let verify = |prefix: &str| {
        let full = format!("{prefix}{name}");
        async move {
            git::run(root, &["rev-parse", "--verify", "--quiet", &full], None)
                .await
                .map(|output| output.code == 0)
        }
    };
    Ok(!verify("refs/heads/").await? && verify("refs/remotes/").await?)
}
fn local(name: &str) -> &str {
    name.split_once('/').map_or(name, |(_, rest)| rest)
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
        local(name)
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
    let stem = format!(
        "{}-{label}",
        repo.project
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    );
    let parent = repo.project.parent().unwrap_or(&repo.project);
    let path = (1..)
        .map(|n| match n {
            1 => parent.join(&stem),
            _ => parent.join(format!("{stem}-{n}")),
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
    let mut args = vec!["worktree", "add"];
    match mode {
        "detached" => args.extend(["--detach", path, reference(base)?]),
        "new" => args.extend(["-b", reference(branch)?, path, reference(base)?]),
        _ if remote(&repo.root, reference(branch)?).await? => {
            args.extend(["--track", "-b", local(branch), path, branch])
        }
        _ => args.extend([path, branch]),
    }
    git::run(&repo.root, &args, None).await?.accept(&[0])?;
    Ok(canonical(path).to_string_lossy().into_owned())
}
async fn count(root: &Path, args: &[&str]) -> Result<u32> {
    Ok(git::text(root, args)
        .await?
        .trim()
        .parse()
        .unwrap_or_default())
}
pub async fn summary(source: &Repo, target: &str) -> Result<Summary> {
    let detached = source.snapshot().await?.branch == "(detached)";
    Ok(Summary {
        ahead: count(
            &source.root,
            &["rev-list", "--count", &format!("{}..HEAD", object(target)?)],
        )
        .await?,
        orphans: if detached {
            count(
                &source.root,
                &[
                    "rev-list",
                    "--count",
                    "HEAD",
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
    let mut args = vec!["worktree", "remove"];
    args.extend(std::iter::repeat_n("--force", force.min(2) as usize));
    args.push(worktree);
    git::run(&repo.root, &args, None).await?.accept(&[0])?;
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
            .accept(&[0])?;
        Ok::<_, Error>(
            git::run_indexed(&source.root, &index, &["write-tree"])
                .await?
                .accept(&[0])?
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
    .accept(&[0])?
    .bytes)
}
async fn changed(root: &Path, base: &str, tree: &str) -> Result<HashSet<String>> {
    Ok(git::text(
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
    .split('\0')
    .filter(|path| !path.is_empty())
    .map(String::from)
    .collect())
}
async fn patched(root: &Path, flags: &[&str], patch: &[u8]) -> Result<git::Output> {
    let mut args = vec!["apply", "--binary", "--whitespace=nowarn"];
    args.extend_from_slice(flags);
    git::run(root, &args, Some(patch)).await
}
async fn unstage(target: &Repo, paths: &HashSet<String>) -> Result<()> {
    let list: Vec<u8> = paths
        .iter()
        .flat_map(|path| path.bytes().chain([0]))
        .collect();
    git::run(
        &target.root,
        &[
            "restore",
            "--staged",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
        ],
        Some(&list),
    )
    .await?
    .accept(&[0])?;
    Ok(())
}
async fn merged(target: &Repo, patch: &[u8], temporary: &str) -> Result<()> {
    if patched(&target.root, &["--index", "--check"], patch)
        .await?
        .code
        == 0
    {
        patched(&target.root, &["--index"], patch)
            .await?
            .accept(&[0])?;
    } else if patched(&target.root, &["--3way"], patch).await?.code != 0 {
        return Err(Error::refused("The worktree's changes conflict with main."));
    }
    for flags in [&["--index"][..], &[]] {
        let mut args = vec!["stash", "apply"];
        args.extend_from_slice(flags);
        args.push(temporary);
        if git::run(&target.root, &args, None).await?.code == 0 {
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
        stash::drop(target, &temporary).await?;
        return unstage(target, paths).await;
    };
    git::run(&target.root, &["reset", "--hard", "--quiet", "HEAD"], None)
        .await?
        .accept(&[0])?;
    for path in stash::untracked(target, &temporary).await? {
        let _ = std::fs::remove_file(target.path(&path)?);
    }
    stash::restore(target, &temporary).await.map_err(|e| {
        Error::new(
            "unexpected",
            format!(
                "Changes remain recoverable in stash {temporary}. {}",
                e.message
            ),
        )
    })?;
    stash::drop(target, &temporary).await?;
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
        &["merge-base", "HEAD", object(&status.oid)?],
        None,
    )
    .await?
    .accept(&[0])
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
    if patched(&target.root, &["--check"], &patch).await?.code == 0 {
        patched(&target.root, &[], &patch).await?.accept(&[0])?;
        return Ok(applied);
    }
    let output = patched(&target.root, &["--3way"], &patch)
        .await?
        .accept(&[0, 1])?;
    applied.conflicts = target
        .refresh()
        .await?
        .entries
        .iter()
        .filter(|entry| matches!(entry, Entry::Unmerged { .. }))
        .count();
    if applied.conflicts == 0 {
        if output.code != 0 {
            return Err(Error::git(output.message()));
        }
        unstage(target, &paths).await?;
    }
    Ok(applied)
}
pub async fn unapply(target: &Repo, base: &str, tree: &str) -> Result<()> {
    target.writable().await?;
    let patch = patch(&target.root, base, tree).await?;
    if patched(&target.root, &["-R", "--check"], &patch)
        .await?
        .code
        != 0
    {
        return Err(Error::refused(
            "Main changed since the apply. Undo it by hand.",
        ));
    }
    patched(&target.root, &["-R"], &patch).await?.accept(&[0])?;
    Ok(())
}
