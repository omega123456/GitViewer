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
            OpenAIError::ApiError(response) => {
                let status = response.status_code.as_u16();
                match status {
                    401 | 403 => Self::new("authentication", "The endpoint rejected the API key"),
                    404 => Self::refused("The endpoint does not serve this route"),
                    _ => Self::refused(format!(
                        "The endpoint refused the request with status {status}"
                    )),
                }
            }
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
            _ => Self::new("unexpected", format!("Keychain access failed: {error}")),
        }
    }
}
