use super::{Endpoints, object::resolve};
use crate::{
    error::{Error, Result},
    git,
    repo::Repo,
};
use serde::Serialize;

const NAME_STATUS_FIELDS: usize = 2;
const NUMSTAT_SEPARATOR: char = '\t';

#[derive(Debug, Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}
#[derive(Debug, Serialize)]
pub struct Comparison {
    pub base: String,
    pub target: String,
    pub files: Vec<ChangedFile>,
}
async fn tree_diff(repo: &Repo, listing: &str, endpoints: Endpoints<'_>) -> Result<Vec<String>> {
    git::nul_list(
        &repo.root,
        &[
            "diff-tree",
            "--no-commit-id",
            listing,
            "-r",
            "-z",
            endpoints.base,
            endpoints.target,
        ],
    )
    .await
}
async fn common_ancestor(repo: &Repo, base: &str, target: &str) -> Result<String> {
    let common = git::run(&repo.root, &["merge-base", base, target], None).await?;
    if !common.succeeded() {
        return Err(Error::refused(
            "These branches have no common commit. Turn off \"Since branches diverged\" to compare them directly.",
        ));
    }
    Ok(common.text().trim().to_owned())
}
fn line_count(field: Option<&str>) -> u32 {
    field.and_then(|count| count.parse().ok()).unwrap_or(0)
}
fn changed_file(entry: &[String], count: &str) -> ChangedFile {
    let mut numbers = count.split(NUMSTAT_SEPARATOR);
    ChangedFile {
        status: entry[0].chars().take(1).collect(),
        path: entry[1].clone(),
        additions: line_count(numbers.next()),
        deletions: line_count(numbers.next()),
    }
}
pub async fn compare(
    repo: &Repo,
    endpoints: Endpoints<'_>,
    merge_base: bool,
) -> Result<Comparison> {
    let mut base = resolve(repo, endpoints.base).await?;
    let target = resolve(repo, endpoints.target).await?;
    if merge_base {
        base = common_ancestor(repo, &base, &target).await?;
    }
    let resolved = Endpoints {
        base: &base,
        target: &target,
    };
    let statuses = tree_diff(repo, "--name-status", resolved).await?;
    let counts = tree_diff(repo, "--numstat", resolved).await?;
    let files = statuses
        .chunks(NAME_STATUS_FIELDS)
        .zip(counts)
        .map(|(entry, count)| changed_file(entry, &count))
        .collect();
    Ok(Comparison {
        base,
        target,
        files,
    })
}
