pub mod detect;

use crate::error::{Error, Result};
use std::{collections::HashSet, path::Path, process::Stdio};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

pub const NUL: char = '\0';
pub const NUL_BYTE: u8 = b'\0';
pub const FULL_HASH_LENGTH: usize = 40;
pub const HEAD: &str = "HEAD";
pub const DOT_GIT: &str = ".git";
pub const PATH_SEPARATOR: &str = "/";
pub const REMOTE_SEPARATOR: char = '/';
pub const UNTRACKED: &str = "?";
pub const UNMODIFIED: &str = ".";
pub const DETACHED_LABEL: &str = "(detached)";
pub const EMPTY_FORMAT: &str = "--format=";
pub const EXIT_SUCCESS: i32 = 0;
pub const EXIT_DIFFERENT: i32 = 1;
pub const EXIT_FATAL: i32 = 128;
const EXIT_USAGE: i32 = 129;
const PROGRESS_CHUNK_BYTES: usize = 4096;
const EXIT_UNKNOWN: i32 = -1;

pub fn first_parent(revision: &str) -> String {
    format!("{revision}^1")
}
pub fn stash_index(stash: &str) -> String {
    format!("{stash}^2")
}
pub fn stash_untracked(stash: &str) -> String {
    format!("{stash}^3")
}
pub fn tree_of(revision: &str) -> String {
    format!("{revision}^{{tree}}")
}
pub fn commit_of(revision: &str) -> String {
    format!("{revision}^{{commit}}")
}
pub fn object_at(revision: &str, path: &str) -> String {
    format!("{revision}:{path}")
}

#[derive(Debug)]
pub struct Output {
    pub code: i32,
    pub bytes: Vec<u8>,
    pub stderr: String,
}
impl Output {
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }
    pub fn message(&self) -> String {
        format!("{}{}", self.text(), self.stderr).trim().to_string()
    }
    pub fn accept(self, codes: &[i32]) -> Result<Self> {
        if codes.contains(&self.code) {
            Ok(self)
        } else {
            Err(Error::git(self.message()))
        }
    }
}

pub async fn run(root: &Path, arguments: &[&str], input: Option<&[u8]>) -> Result<Output> {
    run_binary("git", root, arguments, input).await
}
pub async fn run_indexed(root: &Path, index: &Path, arguments: &[&str]) -> Result<Output> {
    let mut command = command("git", root, arguments);
    command.env("GIT_INDEX_FILE", index);
    execute(command, None).await
}
pub async fn run_binary(
    binary: &str,
    root: &Path,
    arguments: &[&str],
    input: Option<&[u8]>,
) -> Result<Output> {
    execute(command(binary, root, arguments), input).await
}
async fn execute(mut command: Command, input: Option<&[u8]>) -> Result<Output> {
    let mut child = command
        .spawn()
        .map_err(|error| Error::new("missing_git", error.to_string()))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or(Error::new("unexpected", "Git stdin unavailable"))?;
    let data = input.map(Vec::from).unwrap_or_default();
    let writer = tokio::spawn(async move { stdin.write_all(&data).await });
    let output = child.wait_with_output().await?;
    let write_result = writer.await.map_err(Error::from)?;
    let code = output.status.code().unwrap_or(EXIT_UNKNOWN);
    if code == EXIT_SUCCESS {
        write_result?;
    }
    if code == EXIT_USAGE {
        let arguments: Vec<_> = command.as_std().get_args().collect();
        tracing::error!(args = ?arguments, "Git rejected application arguments");
    }
    Ok(Output {
        code,
        bytes: output.stdout,
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}
fn report<F: Fn(&str)>(progress: &F, segment: &[u8]) {
    let text = String::from_utf8_lossy(segment);
    let text = text.trim();
    if !text.is_empty() {
        progress(text);
    }
}
pub async fn stream<F: Fn(&str)>(root: &Path, arguments: &[&str], progress: F) -> Result<Output> {
    let mut child = command("git", root, arguments)
        .spawn()
        .map_err(|error| Error::new("missing_git", error.to_string()))?;
    drop(child.stdin.take());
    let mut stdout = child
        .stdout
        .take()
        .ok_or(Error::new("unexpected", "Git stdout unavailable"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or(Error::new("unexpected", "Git stderr unavailable"))?;
    let collector = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).await.map(|_| bytes)
    });
    let mut raw: Vec<u8> = Vec::new();
    let mut reported = 0;
    let mut chunk = [0u8; PROGRESS_CHUNK_BYTES];
    loop {
        let read = stderr.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        raw.extend_from_slice(&chunk[..read]);
        while let Some(offset) = raw[reported..]
            .iter()
            .position(|byte| matches!(byte, b'\r' | b'\n'))
        {
            report(&progress, &raw[reported..reported + offset]);
            reported += offset + 1;
        }
    }
    report(&progress, &raw[reported..]);
    let status = child.wait().await?;
    Ok(Output {
        code: status.code().unwrap_or(EXIT_UNKNOWN),
        bytes: collector.await.map_err(Error::from)??,
        stderr: String::from_utf8_lossy(&raw).into_owned(),
    })
}
pub async fn text(root: &Path, arguments: &[&str]) -> Result<String> {
    Ok(run(root, arguments, None)
        .await?
        .accept(&[EXIT_SUCCESS])?
        .text())
}
pub async fn ignored<'a>(
    root: &Path,
    paths: impl IntoIterator<Item = &'a str>,
) -> Result<HashSet<String>> {
    let input: Vec<u8> = paths
        .into_iter()
        .flat_map(|path| path.bytes().chain([0]))
        .collect();
    Ok(run(root, &["check-ignore", "--stdin", "-z"], Some(&input))
        .await?
        .accept(&[0, 1])?
        .text()
        .split(NUL)
        .filter(|path| !path.is_empty())
        .map(String::from)
        .collect())
}

pub fn command(binary: &str, root: &Path, arguments: &[&str]) -> Command {
    let mut command = Command::new(binary);
    command
        .current_dir(root)
        .args([
            "--no-optional-locks",
            "-c",
            "core.quotepath=false",
            "-c",
            "color.ui=false",
        ])
        .args(
            if arguments.first().is_some_and(|argument| {
                [
                    "diff",
                    "diff-files",
                    "add",
                    "rm",
                    "restore",
                    "log",
                    "blame",
                    "diff-tree",
                ]
                .contains(argument)
            }) {
                vec!["--literal-pathspecs"]
            } else {
                Vec::new()
            },
        )
        .args(arguments)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("LC_ALL", "C")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(feature = "test-utils")]
    {
        command.env("GIT_CONFIG_NOSYSTEM", "1").env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        );
    }
    command
}
