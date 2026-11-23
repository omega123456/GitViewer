use crate::git::run_binary;
use serde::Serialize;
use std::{fmt, future::Future, path::Path};

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
pub struct Environment {
    pub found: bool,
    pub version: String,
    pub supported: bool,
    pub minimum: String,
}

fn parse_version(version: &str) -> Option<GitVersion> {
    let values: Vec<u32> = version
        .trim()
        .trim_start_matches("git version ")
        .split('.')
        .take(2)
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

pub async fn with<P, F>(probe: P) -> Environment
where
    P: FnOnce() -> F,
    F: Future<Output = Option<String>>,
{
    match probe().await {
        Some(reported) => Environment {
            found: true,
            supported: version_supported(&reported),
            version: reported
                .trim()
                .trim_start_matches("git version ")
                .to_string(),
            minimum: MINIMUM_GIT_VERSION.to_string(),
        },
        None => Environment {
            found: false,
            supported: false,
            version: String::new(),
            minimum: MINIMUM_GIT_VERSION.to_string(),
        },
    }
}

pub async fn binary_version(binary: &str) -> Option<String> {
    match run_binary(binary, Path::new("."), &["--version"], None).await {
        Ok(output) if output.code == 0 => Some(output.text()),
        _ => None,
    }
}

pub struct Detector(tokio::sync::OnceCell<Environment>);
impl Detector {
    pub const fn new() -> Self {
        Self(tokio::sync::OnceCell::const_new())
    }
    pub async fn detect<P, F>(&self, probe: P) -> Environment
    where
        P: FnOnce() -> F,
        F: Future<Output = Option<String>>,
    {
        let found = self
            .0
            .get_or_try_init(|| async {
                let found = with(probe).await;
                if found.supported {
                    Ok(found)
                } else {
                    Err(found)
                }
            })
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

pub async fn environment() -> Environment {
    DETECTED.detect(|| binary_version("git")).await
}
