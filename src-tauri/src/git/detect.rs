use crate::git::{run_binary, EXIT_SUCCESS};
use serde::Serialize;
use std::{fmt, future::Future};

const VERSION_SEPARATOR: char = '.';
const VERSION_PARTS: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
}

impl fmt::Display for GitVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}.{}", self.major, self.minor)
    }
}

pub const MINIMUM_GIT_VERSION: GitVersion = GitVersion {
    major: 2,
    minor: 38,
};

#[derive(Clone, Debug, Serialize)]
pub struct GitEnvironment {
    pub found: bool,
    pub version: String,
    pub supported: bool,
    pub minimum: String,
}
impl GitEnvironment {
    fn missing() -> Self {
        Self {
            found: false,
            supported: false,
            version: String::new(),
            minimum: MINIMUM_GIT_VERSION.to_string(),
        }
    }
    fn reported(reported: &str) -> Self {
        Self {
            found: true,
            supported: version_supported(reported),
            version: reported
                .trim()
                .trim_start_matches("git version ")
                .to_string(),
            minimum: MINIMUM_GIT_VERSION.to_string(),
        }
    }
}

fn parse_version(version: &str) -> Option<GitVersion> {
    let values: Vec<u32> = version
        .trim()
        .trim_start_matches("git version ")
        .split(VERSION_SEPARATOR)
        .take(VERSION_PARTS)
        .filter_map(|part| part.parse().ok())
        .collect();
    match values.as_slice() {
        [major, minor] => Some(GitVersion {
            major: *major,
            minor: *minor,
        }),
        _ => None,
    }
}

pub fn version_supported(version: &str) -> bool {
    parse_version(version).is_some_and(|parsed| parsed >= MINIMUM_GIT_VERSION)
}

pub async fn with<P, F>(probe: P) -> GitEnvironment
where
    P: FnOnce() -> F,
    F: Future<Output = Option<String>>,
{
    probe()
        .await
        .map_or_else(GitEnvironment::missing, |reported| {
            GitEnvironment::reported(&reported)
        })
}

pub async fn binary_version(binary: &str) -> Option<String> {
    match run_binary(binary, &["--version"]).await {
        Ok(output) if output.code == EXIT_SUCCESS => Some(output.text()),
        _ => None,
    }
}

fn supported_or_rejected(
    found: GitEnvironment,
) -> std::result::Result<GitEnvironment, GitEnvironment> {
    if found.supported {
        return Ok(found);
    }
    Err(found)
}
pub struct Detector(tokio::sync::OnceCell<GitEnvironment>);
impl Detector {
    pub const fn new() -> Self {
        Self(tokio::sync::OnceCell::const_new())
    }
    pub async fn detect<P, F>(&self, probe: P) -> GitEnvironment
    where
        P: FnOnce() -> F,
        F: Future<Output = Option<String>>,
    {
        let found = self
            .0
            .get_or_try_init(|| async { supported_or_rejected(with(probe).await) })
            .await;
        match found {
            Ok(found) => found.clone(),
            Err(found) => found,
        }
    }
}
impl Default for Detector {
    fn default() -> Self {
        Self::new()
    }
}
static DETECTED: Detector = Detector::new();

pub async fn environment() -> GitEnvironment {
    DETECTED.detect(|| binary_version("git")).await
}
