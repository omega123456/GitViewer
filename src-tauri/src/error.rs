use reqwest::StatusCode;
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
    pub fn unexpected(message: impl Into<String>) -> Self {
        Self::new("unexpected", message)
    }
    fn unexpected_from(error: impl std::fmt::Display) -> Self {
        Self::unexpected(error.to_string())
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
        .any(|keyword| lower.contains(keyword))
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
        .any(|keyword| lower.contains(keyword))
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
        Self::unexpected_from(error)
    }
}
impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::unexpected_from(error)
    }
}
pub type Result<T> = std::result::Result<T, Error>;

impl From<tauri::Error> for Error {
    fn from(error: tauri::Error) -> Self {
        Self::unexpected_from(error)
    }
}
impl From<notify::Error> for Error {
    fn from(error: notify::Error) -> Self {
        Self::unexpected_from(error)
    }
}
impl From<tokio::task::JoinError> for Error {
    fn from(error: tokio::task::JoinError) -> Self {
        Self::unexpected_from(error)
    }
}

impl From<tauri_plugin_opener::Error> for Error {
    fn from(error: tauri_plugin_opener::Error) -> Self {
        Self::unexpected_from(error)
    }
}

impl From<reqwest::Error> for Error {
    fn from(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::new("network", "The endpoint did not answer in time")
        } else {
            Self::new("network", "The endpoint could not be reached")
        }
    }
}

impl From<async_openai::error::OpenAIError> for Error {
    fn from(error: async_openai::error::OpenAIError) -> Self {
        use async_openai::error::OpenAIError;
        match error {
            OpenAIError::Reqwest(error) => Self::from(error),
            OpenAIError::ApiError(response) => match response.status_code {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                    Self::new("authentication", "The endpoint rejected the API key")
                }
                StatusCode::NOT_FOUND => Self::refused("The endpoint does not serve this route"),
                status => Self::refused(format!(
                    "The endpoint refused the request with status {}",
                    status.as_u16()
                )),
            },
            OpenAIError::JSONDeserialize(..) => {
                Self::refused("The endpoint returned a response the application could not read")
            }
            _ => Self::refused("The request to the endpoint could not be completed"),
        }
    }
}

#[cfg(not(feature = "test-utils"))]
impl From<keyring::Error> for Error {
    fn from(error: keyring::Error) -> Self {
        match error {
            keyring::Error::NoEntry => Self::refused("No API key is stored"),
            _ => Self::unexpected(format!("Keychain access failed: {error}")),
        }
    }
}
