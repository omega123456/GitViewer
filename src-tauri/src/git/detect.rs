use crate::git::run_binary;
use serde::Serialize;
use std::{future::Future, path::Path};

#[derive(Clone, Debug, Serialize)]
pub struct Environment {
    pub found: bool,
    pub version: String,
    pub supported: bool,
}

pub fn version_supported(version: &str) -> bool {
    let values: Vec<u32> = version
        .trim()
        .trim_start_matches("git version ")
        .split('.')
        .take(2)
        .filter_map(|p| p.parse().ok())
        .collect();
    matches!(values.as_slice(), [major, minor] if (*major, *minor) >= (2, 38))
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
        },
        None => Environment {
            found: false,
            supported: false,
            version: String::new(),
        },
    }
}

pub async fn binary_version(binary: &str) -> Option<String> {
    match run_binary(binary, Path::new("."), &["--version"], None).await {
        Ok(output) if output.code == 0 => Some(output.text()),
        _ => None,
    }
}

pub async fn environment() -> Environment {
    with(|| binary_version("git")).await
}
