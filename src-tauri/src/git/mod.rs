pub mod detect;
#[cfg(feature = "test-utils")]
pub mod trace;

use crate::error::{Error, Result};
use std::{
    collections::HashSet,
    path::Path,
    process::{ExitStatus, Stdio},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    task::JoinHandle,
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
pub const SUCCESS_OR_DIFFERENT: [i32; 2] = [EXIT_SUCCESS, EXIT_DIFFERENT];
pub const PINNED_DIFF_FLAGS: [&str; 3] = ["--no-ext-diff", "--no-textconv", "--no-color"];
pub const DIFF_PREFIXES: [&str; 2] = ["--src-prefix=a/", "--dst-prefix=b/"];
const PATHSPEC_FROM_STDIN: [&str; 2] = ["--pathspec-from-file=-", "--pathspec-file-nul"];
const LOCAL_BRANCHES: &str = "refs/heads/";
const REMOTE_BRANCHES: &str = "refs/remotes/";
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
pub fn index_object(path: &str) -> String {
    object_at("", path)
}
pub fn local_branch(name: &str) -> String {
    format!("{LOCAL_BRANCHES}{name}")
}
pub fn remote_branch(name: &str) -> String {
    format!("{REMOTE_BRANCHES}{name}")
}
pub fn range(from: &str, to: &str) -> String {
    format!("{from}..{to}")
}
pub fn symmetric_range(from: &str, to: &str) -> String {
    format!("{from}...{to}")
}

pub struct RemoteBranch<'name> {
    pub remote: &'name str,
    pub branch: &'name str,
}
pub fn split_remote(name: &str) -> Option<RemoteBranch<'_>> {
    let (remote, branch) = name.split_once(REMOTE_SEPARATOR)?;
    Some(RemoteBranch { remote, branch })
}
pub fn without_remote(name: &str) -> &str {
    split_remote(name).map_or(name, |remote| remote.branch)
}

pub fn nul_terminated<'path>(paths: impl IntoIterator<Item = &'path str>) -> Vec<u8> {
    paths
        .into_iter()
        .flat_map(|path| path.bytes().chain([NUL_BYTE]))
        .collect()
}
pub fn nul_fields(text: &str) -> impl Iterator<Item = &str> {
    text.split(NUL).filter(|field| !field.is_empty())
}

#[derive(Debug)]
pub struct Output {
    pub code: i32,
    pub bytes: Vec<u8>,
    pub stderr: String,
}
impl Output {
    fn new(status: ExitStatus, bytes: Vec<u8>, stderr: &[u8]) -> Self {
        Self {
            code: status.code().unwrap_or(EXIT_UNKNOWN),
            bytes,
            stderr: String::from_utf8_lossy(stderr).into_owned(),
        }
    }
    pub fn succeeded(&self) -> bool {
        self.code == EXIT_SUCCESS
    }
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }
    pub fn message(&self) -> String {
        format!("{}{}", self.text(), self.stderr).trim().to_string()
    }
    pub fn accept(self, codes: &[i32]) -> Result<Self> {
        if !codes.contains(&self.code) {
            return Err(Error::git(self.message()));
        }
        Ok(self)
    }
}

pub async fn run(root: &Path, arguments: &[&str], input: Option<&[u8]>) -> Result<Output> {
    execute(command("git", root, arguments), input).await
}
pub async fn run_indexed(root: &Path, index: &Path, arguments: &[&str]) -> Result<Output> {
    let mut command = command("git", root, arguments);
    command.env("GIT_INDEX_FILE", index);
    execute(command, None).await
}
pub async fn run_binary(binary: &str, arguments: &[&str]) -> Result<Output> {
    execute(command(binary, Path::new("."), arguments), None).await
}
pub struct Piped {
    pub child: Child,
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
    pub stderr: ChildStderr,
}
fn pipe<Stream>(stream: Option<Stream>, name: &str) -> Result<Stream> {
    stream.ok_or_else(|| Error::unexpected(format!("Git {name} unavailable")))
}
fn spawn(command: &mut Command) -> Result<Child> {
    command
        .spawn()
        .map_err(|error| Error::new("missing_git", error.to_string()))
}
pub fn spawn_piped(command: &mut Command) -> Result<Piped> {
    let mut child = spawn(command)?;
    Ok(Piped {
        stdin: pipe(child.stdin.take(), "stdin")?,
        stdout: pipe(child.stdout.take(), "stdout")?,
        stderr: pipe(child.stderr.take(), "stderr")?,
        child,
    })
}
pub fn collect<Stream: AsyncRead + Unpin + Send + 'static>(
    mut stream: Stream,
) -> JoinHandle<std::io::Result<Vec<u8>>> {
    tokio::spawn(async move {
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).await.map(|_| bytes)
    })
}
pub fn feed(mut stdin: ChildStdin, input: Vec<u8>) -> JoinHandle<std::io::Result<()>> {
    tokio::spawn(async move { stdin.write_all(&input).await })
}
pub async fn finish<Value>(task: JoinHandle<std::io::Result<Value>>) -> Result<Value> {
    Ok(task.await.map_err(Error::from)??)
}
async fn execute(mut command: Command, input: Option<&[u8]>) -> Result<Output> {
    let mut child = spawn(&mut command)?;
    let stdin = pipe(child.stdin.take(), "stdin")?;
    let data = input.map(Vec::from).unwrap_or_default();
    let writer = feed(stdin, data);
    let finished = child.wait_with_output().await?;
    let output = Output::new(finished.status, finished.stdout, &finished.stderr);
    let write_result = writer.await.map_err(Error::from)?;
    if output.succeeded() {
        write_result?;
    }
    if output.code == EXIT_USAGE {
        let arguments: Vec<_> = command.as_std().get_args().collect();
        tracing::error!(args = ?arguments, "Git rejected application arguments");
    }
    Ok(output)
}
fn report<F: Fn(&str)>(progress: &F, segment: &[u8]) {
    let text = String::from_utf8_lossy(segment);
    let text = text.trim();
    if !text.is_empty() {
        progress(text);
    }
}
pub async fn stream<F: Fn(&str)>(root: &Path, arguments: &[&str], progress: F) -> Result<Output> {
    let piped = spawn_piped(&mut command("git", root, arguments))?;
    drop(piped.stdin);
    let collector = collect(piped.stdout);
    let mut stderr = piped.stderr;
    let mut child = piped.child;
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
    Ok(Output::new(status, finish(collector).await?, &raw))
}
pub async fn text(root: &Path, arguments: &[&str]) -> Result<String> {
    Ok(run(root, arguments, None)
        .await?
        .accept(&[EXIT_SUCCESS])?
        .text())
}
pub async fn nul_list(root: &Path, arguments: &[&str]) -> Result<Vec<String>> {
    Ok(nul_fields(&text(root, arguments).await?)
        .map(String::from)
        .collect())
}
pub async fn succeeded(root: &Path, arguments: &[&str]) -> Result<bool> {
    Ok(run(root, arguments, None)
        .await?
        .accept(&SUCCESS_OR_DIFFERENT)?
        .succeeded())
}
pub async fn is_ancestor(root: &Path, earlier: &str, later: &str) -> Result<bool> {
    succeeded(root, &["merge-base", "--is-ancestor", earlier, later]).await
}
pub async fn ref_exists(root: &Path, reference: &str) -> Result<bool> {
    Ok(
        run(root, &["rev-parse", "--verify", "--quiet", reference], None)
            .await?
            .succeeded(),
    )
}
pub async fn merge_conflicts(root: &Path, ours: &str, theirs: &str) -> Result<Option<String>> {
    let merged = run(
        root,
        &["merge-tree", "--write-tree", "--name-only", ours, theirs],
        None,
    )
    .await?
    .accept(&SUCCESS_OR_DIFFERENT)?;
    if merged.succeeded() {
        return Ok(None);
    }
    Ok(Some(merged.text()))
}
pub async fn run_with_pathspec<'path>(
    root: &Path,
    arguments: &[&str],
    paths: impl IntoIterator<Item = &'path str>,
) -> Result<Output> {
    let mut command = arguments.to_vec();
    command.extend(PATHSPEC_FROM_STDIN);
    run(root, &command, Some(&nul_terminated(paths)))
        .await?
        .accept(&[EXIT_SUCCESS])
}
pub async fn apply_checked(root: &Path, arguments: &[&str], patch: &[u8]) -> Result<Output> {
    let mut check = arguments.to_vec();
    check.push("--check");
    let checked = run(root, &check, Some(patch)).await?;
    if !checked.succeeded() {
        return Ok(checked);
    }
    run(root, arguments, Some(patch))
        .await?
        .accept(&[EXIT_SUCCESS])
}
pub async fn untracked_in_stash(root: &Path, stash: &str, listing: &[&str]) -> Result<Vec<String>> {
    let untracked_commit = stash_untracked(stash);
    if !ref_exists(root, &untracked_commit).await? {
        return Ok(Vec::new());
    }
    let mut arguments = vec!["ls-tree", "-r", "-z"];
    arguments.extend_from_slice(listing);
    arguments.push(&untracked_commit);
    nul_list(root, &arguments).await
}
pub async fn ignored<'a>(
    root: &Path,
    paths: impl IntoIterator<Item = &'a str>,
) -> Result<HashSet<String>> {
    let input = nul_terminated(paths);
    Ok(nul_fields(
        &run(root, &["check-ignore", "--stdin", "-z"], Some(&input))
            .await?
            .accept(&SUCCESS_OR_DIFFERENT)?
            .text(),
    )
    .map(String::from)
    .collect())
}

const PATHSPEC_COMMANDS: [&str; 8] = [
    "diff",
    "diff-files",
    "add",
    "rm",
    "restore",
    "log",
    "blame",
    "diff-tree",
];
#[cfg(all(feature = "test-utils", windows))]
const NULL_DEVICE: &str = "NUL";
#[cfg(all(feature = "test-utils", not(windows)))]
const NULL_DEVICE: &str = "/dev/null";
fn pathspec_flags(arguments: &[&str]) -> &'static [&'static str] {
    let takes_pathspecs = arguments
        .first()
        .is_some_and(|argument| PATHSPEC_COMMANDS.contains(argument));
    if takes_pathspecs {
        return &["--literal-pathspecs"];
    }
    &[]
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
        .args(pathspec_flags(arguments))
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
        command
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", NULL_DEVICE);
        trace::send_events_to_target(&mut command);
    }
    command
}
