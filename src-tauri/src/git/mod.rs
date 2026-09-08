pub mod detect;

use crate::error::{Error, Result};
use std::{path::Path, process::Stdio};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

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

pub async fn run(root: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Output> {
    run_binary("git", root, args, input).await
}
pub async fn run_binary(
    binary: &str,
    root: &Path,
    args: &[&str],
    input: Option<&[u8]>,
) -> Result<Output> {
    let mut command = command(binary, root, args);
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
    let code = output.status.code().unwrap_or(-1);
    if code == 0 {
        write_result?;
    }
    if code == 129 {
        tracing::error!(?args, "Git rejected application arguments");
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
pub async fn stream<F: Fn(&str)>(root: &Path, args: &[&str], progress: F) -> Result<Output> {
    let mut child = command("git", root, args)
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
    let mut chunk = [0u8; 4096];
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
        code: status.code().unwrap_or(-1),
        bytes: collector.await.map_err(Error::from)??,
        stderr: String::from_utf8_lossy(&raw).into_owned(),
    })
}
pub async fn text(root: &Path, args: &[&str]) -> Result<String> {
    Ok(run(root, args, None).await?.accept(&[0])?.text())
}

pub fn command(binary: &str, root: &Path, args: &[&str]) -> Command {
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
            if args.first().is_some_and(|arg| {
                ["diff", "add", "rm", "restore", "log", "blame", "diff-tree"].contains(arg)
            }) {
                vec!["--literal-pathspecs"]
            } else {
                Vec::new()
            },
        )
        .args(args)
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
    #[cfg(feature = "test-utils")]
    {
        command.env("GIT_CONFIG_NOSYSTEM", "1").env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        );
        command.args([] as [&str; 0]);
    }
    command
}
