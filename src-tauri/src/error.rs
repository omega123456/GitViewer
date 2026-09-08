use serde::Serialize;

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct Error {
    pub category: String,
    pub message: String,
}

impl Error {
    pub fn new(category: &str, message: impl Into<String>) -> Self {
        Self {
            category: category.into(),
            message: message.into(),
        }
    }
    pub fn refused(message: impl Into<String>) -> Self {
        Self::new("refused", message)
    }
    pub fn git(message: String) -> Self {
        let lower = message.to_lowercase();
        let category = if [
            "authentication",
            "permission denied",
            "could not read username",
            "credential",
        ]
        .iter()
        .any(|s| lower.contains(s))
        {
            "authentication"
        } else if [
            "could not resolve",
            "unable to access",
            "network",
            "connection",
            "timed out",
        ]
        .iter()
        .any(|s| lower.contains(s))
        {
            "network"
        } else {
            "refused"
        };
        Self::new(category, message)
    }
}
impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::new("unexpected", error.to_string())
    }
}
impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::new("unexpected", error.to_string())
    }
}
pub type Result<T> = std::result::Result<T, Error>;

impl From<tauri::Error> for Error {
    fn from(error: tauri::Error) -> Self {
        Self::new("unexpected", error.to_string())
    }
}
impl From<notify::Error> for Error {
    fn from(error: notify::Error) -> Self {
        Self::new("unexpected", error.to_string())
    }
}
impl From<tokio::task::JoinError> for Error {
    fn from(error: tokio::task::JoinError) -> Self {
        Self::new("unexpected", error.to_string())
    }
}

impl From<tauri_plugin_opener::Error> for Error {
    fn from(error: tauri_plugin_opener::Error) -> Self {
        Self::new("unexpected", error.to_string())
    }
}
