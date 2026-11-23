use super::{
    apply::add_patches,
    image_size::dimensions,
    object::{
        measure, object_sizes, original_path, over_line_limit, resolve, side_bytes, size_limit,
        stash_has_untracked, Blob,
    },
    parse::parse,
    Diff, DiffRef, DiffSource, ReadOptions, Side,
};
use crate::{error::Result, fs, git, media::is_image, repo::Repo};
use std::path::PathBuf;

const MAX_CONTEXT_LINES: u32 = 50_000;

#[derive(Default)]
struct Revisions {
    parent: String,
    sha: String,
}
async fn revisions(repo: &Repo, reference: DiffRef<'_>) -> Result<Revisions> {
    match reference.source {
        DiffSource::Commit | DiffSource::Stash => commit_revisions(repo, reference.revision).await,
        DiffSource::Compare => Ok(Revisions {
            parent: resolve(repo, reference.base).await?,
            sha: resolve(repo, reference.revision).await?,
        }),
        DiffSource::Staged | DiffSource::Unstaged | DiffSource::File => Ok(Revisions::default()),
    }
}
async fn commit_revisions(repo: &Repo, revision: &str) -> Result<Revisions> {
    let sha = resolve(repo, revision).await?;
    Ok(Revisions {
        parent: git::first_parent(&sha),
        sha,
    })
}
async fn untracked_in_stash(
    repo: &Repo,
    reference: DiffRef<'_>,
    revisions: &Revisions,
) -> Result<bool> {
    if reference.source != DiffSource::Stash {
        return Ok(false);
    }
    stash_has_untracked(repo, &revisions.sha, reference.path).await
}

struct Sides {
    old: Blob,
    new: Blob,
}
struct Plan<'a> {
    reference: DiffRef<'a>,
    options: ReadOptions,
    revisions: Revisions,
    untracked: bool,
    original: Option<String>,
    sides: Sides,
}
struct Located<'a> {
    reference: DiffRef<'a>,
    revisions: &'a Revisions,
    untracked: bool,
    original: Option<&'a str>,
}
fn sides(located: Located<'_>, full: PathBuf) -> Sides {
    let Located {
        reference,
        revisions,
        untracked,
        original,
    } = located;
    let path = reference.path;
    match reference.source {
        DiffSource::File => Sides {
            old: Blob::Absent,
            new: Blob::Working(full),
        },
        _ if untracked => Sides {
            old: Blob::Absent,
            new: Blob::Object(git::object_at(&git::stash_untracked(&revisions.sha), path)),
        },
        DiffSource::Unstaged => Sides {
            old: Blob::Object(git::index_object(path)),
            new: Blob::Working(full),
        },
        DiffSource::Staged => Sides {
            old: Blob::Object(git::object_at(git::HEAD, original.unwrap_or(path))),
            new: Blob::Object(git::index_object(path)),
        },
        DiffSource::Commit | DiffSource::Stash | DiffSource::Compare => Sides {
            old: Blob::Object(git::object_at(&revisions.parent, path)),
            new: Blob::Object(git::object_at(&revisions.sha, path)),
        },
    }
}
impl<'a> Plan<'a> {
    async fn prepare(repo: &Repo, reference: DiffRef<'a>, options: ReadOptions) -> Result<Self> {
        let full = repo.path(reference.path)?;
        let revisions = revisions(repo, reference).await?;
        let untracked = untracked_in_stash(repo, reference, &revisions).await?;
        let original = original_path(repo, reference, Side::Old).await?;
        let located = Located {
            reference,
            revisions: &revisions,
            untracked,
            original: original.as_deref(),
        };
        let sides = sides(located, full);
        Ok(Self {
            reference,
            options,
            revisions,
            untracked,
            original,
            sides,
        })
    }
    fn rooted(&self) -> bool {
        self.reference.source.is_revision() && !self.untracked
    }
    fn shows_whole_file(&self) -> bool {
        self.reference.source == DiffSource::File || self.untracked
    }
    fn image(&self) -> bool {
        is_image(self.reference.path)
    }
    fn size_specs(&self) -> Vec<&str> {
        let mut specs = Vec::new();
        if self.rooted() {
            specs.push(self.revisions.parent.as_str());
        }
        let objects = [&self.sides.old, &self.sides.new]
            .into_iter()
            .filter_map(Blob::object_spec);
        specs.extend(objects);
        specs
    }
}

struct Measured {
    root: bool,
    old_size: usize,
    new_size: usize,
}
fn next_object_size(blob: &Blob, sizes: &mut impl Iterator<Item = Option<usize>>) -> Option<usize> {
    match blob {
        Blob::Object(_) => sizes.next().flatten(),
        _ => None,
    }
}
async fn measured(repo: &Repo, plan: &Plan<'_>) -> Result<Measured> {
    let mut sizes = object_sizes(repo, &plan.size_specs()).await?.into_iter();
    let root = plan.rooted() && sizes.next().flatten().is_none();
    let old_size = next_object_size(&plan.sides.old, &mut sizes);
    let new_size = next_object_size(&plan.sides.new, &mut sizes);
    Ok(Measured {
        root,
        old_size: measure(repo, &plan.sides.old, old_size).await?,
        new_size: measure(repo, &plan.sides.new, new_size).await?,
    })
}
fn exceeds_size_limit(plan: &Plan<'_>, result: &Diff) -> bool {
    let image = plan.image();
    let enforces_limit = image || !plan.options.override_limit;
    let largest = result.old_size.max(result.new_size);
    enforces_limit && largest > size_limit(image)
}
async fn image_diff(repo: &Repo, plan: &Plan<'_>, result: Diff) -> Result<Diff> {
    let old_bytes = side_bytes(repo, &plan.sides.old, result.old_size).await?;
    let new_bytes = side_bytes(repo, &plan.sides.new, result.new_size).await?;
    Ok(Diff {
        old_dimensions: dimensions(&old_bytes),
        new_dimensions: dimensions(&new_bytes),
        ..result
    })
}
async fn added_file(repo: &Repo, reference: DiffRef<'_>) -> Result<bool> {
    if reference.source == DiffSource::Stash {
        return Ok(true);
    }
    let untracked = git::text(
        &repo.root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            reference.path,
        ],
    )
    .await?;
    Ok(!untracked.is_empty())
}
async fn whole_file(repo: &Repo, plan: &Plan<'_>, result: Diff) -> Result<Diff> {
    let new = side_bytes(repo, &plan.sides.new, result.new_size).await?;
    if fs::is_binary(&new) {
        return Ok(Diff {
            binary: true,
            ..result
        });
    }
    let content = String::from_utf8_lossy(&new);
    let too_long = !plan.options.override_limit && over_line_limit(&content);
    if too_long {
        return Ok(Diff {
            too_large: true,
            ..result
        });
    }
    Ok(Diff {
        content: Some(content.into_owned()),
        added: added_file(repo, plan.reference).await?,
        ..result
    })
}
fn comparison_arguments<'a>(command: &[&'a str], context: &'a str) -> Vec<&'a str> {
    let mut arguments = command.to_vec();
    arguments.extend(git::PINNED_DIFF_FLAGS);
    arguments.extend(["--find-renames", context]);
    arguments
}
fn root_arguments<'a>(sha: &'a str, context: &'a str) -> Vec<&'a str> {
    let mut arguments = vec!["show", "--root", git::EMPTY_FORMAT];
    arguments.extend(git::PINNED_DIFF_FLAGS);
    arguments.extend([context, sha]);
    arguments
}
fn selection_arguments<'a>(plan: &'a Plan<'_>, root: bool, context: &'a str) -> Vec<&'a str> {
    let source = plan.reference.source;
    if source == DiffSource::Staged {
        let mut arguments = comparison_arguments(&["diff"], context);
        arguments.push("--cached");
        return arguments;
    }
    if source == DiffSource::Unstaged {
        return comparison_arguments(&["diff-files", "-p"], context);
    }
    if root {
        return root_arguments(&plan.revisions.sha, context);
    }
    let mut arguments = comparison_arguments(&["diff"], context);
    arguments.extend([plan.revisions.parent.as_str(), plan.revisions.sha.as_str()]);
    arguments
}
async fn patch_diff(repo: &Repo, plan: &Plan<'_>, measured: Measured) -> Result<Diff> {
    let path = plan.reference.path;
    let context = format!("--unified={}", plan.options.context.min(MAX_CONTEXT_LINES));
    let mut arguments = selection_arguments(plan, measured.root, &context);
    arguments.extend(["--", path]);
    arguments.extend(plan.original.as_deref());
    let output = git::text(&repo.root, &arguments).await?;
    let too_long = !plan.options.override_limit && over_line_limit(&output);
    if too_long {
        return Ok(Diff {
            too_large: true,
            ..sized_diff(plan, &measured)
        });
    }
    Ok(Diff {
        old_size: measured.old_size,
        new_size: measured.new_size,
        ..parse(&output, path, plan.reference.source)?
    })
}
fn sized_diff(plan: &Plan<'_>, measured: &Measured) -> Diff {
    Diff {
        image: plan.image(),
        old_size: measured.old_size,
        new_size: measured.new_size,
        ..Diff::empty(plan.reference.path, plan.reference.source)
    }
}
pub async fn read(repo: &Repo, reference: DiffRef<'_>, options: ReadOptions) -> Result<Diff> {
    let plan = Plan::prepare(repo, reference, options).await?;
    let measured = measured(repo, &plan).await?;
    let result = sized_diff(&plan, &measured);
    if exceeds_size_limit(&plan, &result) {
        return Ok(Diff {
            too_large: true,
            ..result
        });
    }
    if plan.image() {
        return image_diff(repo, &plan, result).await;
    }
    if plan.shows_whole_file() {
        return whole_file(repo, &plan, result).await;
    }
    patch_diff(repo, &plan, measured).await
}
pub async fn read_patched(
    repo: &Repo,
    reference: DiffRef<'_>,
    options: ReadOptions,
) -> Result<Diff> {
    let mut diff = read(repo, reference, options).await?;
    add_patches(&mut diff);
    Ok(diff)
}
