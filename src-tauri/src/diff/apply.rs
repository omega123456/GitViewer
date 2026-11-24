use super::{
    Diff, DiffRef, DiffSource, Hunk, HunkRequest, ReadOptions, parse::NO_NEWLINE_MARKER, quote,
    read::read,
};
use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
};

const CONTROL_CHARACTERS: [char; 3] = ['\n', '\r', git::NUL];
const STAGE: &str = "stage";
const UNSTAGE: &str = "unstage";
const DISCARD: &str = "discard";

pub fn add_patches(diff: &mut Diff) {
    if !diff.source.is_uncommitted() {
        return;
    }
    diff.patches = diff
        .hunks
        .iter()
        .map(|hunk| patch(&diff.path, hunk).unwrap_or_default())
        .collect();
}
pub fn patch(path: &str, hunk: &Hunk) -> Result<String> {
    if path.contains(CONTROL_CHARACTERS) {
        return Err(Error::refused(
            "Hunk actions are unavailable for paths containing control characters; use file staging",
        ));
    }
    let old_path = quote::always_quoted(quote::OLD_PREFIX, path);
    let new_path = quote::always_quoted(quote::NEW_PREFIX, path);
    let mut patch = format!(
        "{}\n--- {old_path}\n+++ {new_path}\n@@ -{},{} +{},{} @@\n",
        quote::diff_header(&old_path, &new_path),
        hunk.old_start,
        hunk.old_count,
        hunk.new_start,
        hunk.new_count
    );
    for line in &hunk.lines {
        patch.push(line.kind.patch_prefix());
        patch.push_str(&line.content);
        patch.push('\n');
        if line.no_newline {
            patch.push_str(NO_NEWLINE_MARKER);
            patch.push('\n');
        }
    }
    Ok(patch)
}
fn permits_hunk_action(source: DiffSource, action: &str) -> bool {
    matches!(
        (source, action),
        (DiffSource::Staged, UNSTAGE)
            | (DiffSource::Unstaged, STAGE)
            | (DiffSource::Unstaged, DISCARD)
    )
}
fn apply_arguments(action: &str) -> Vec<&'static str> {
    let mut arguments = vec!["apply", "--whitespace=nowarn"];
    if action != DISCARD {
        arguments.push("--cached");
    }
    if action != STAGE {
        arguments.push("--reverse");
    }
    arguments
}
pub async fn apply_hunk(repo: &Repo, request: HunkRequest<'_>) -> Result<()> {
    let HunkRequest {
        path,
        source,
        hunk,
        expected,
        action,
    } = request;
    repo.writable().await?;
    if !permits_hunk_action(source, action) {
        return Err(Error::refused(
            "This action is not permitted for this diff source",
        ));
    }
    let diff = read(repo, DiffRef::working(path, source), ReadOptions::UNLIMITED).await?;
    let hunk = diff
        .hunks
        .get(hunk)
        .ok_or_else(|| Error::refused("The hunk changed; select it again"))?;
    let patch = patch(path, hunk)?;
    if patch != expected {
        return Err(Error::refused(
            "The diff changed since it was shown; review it again",
        ));
    }
    git::apply_checked(&repo.root, &apply_arguments(action), patch.as_bytes())
        .await?
        .accept(&[git::EXIT_SUCCESS])?;
    Ok(())
}
