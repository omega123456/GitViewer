use crate::{error::Result, lock::lock_recovering};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub tabs: Vec<Tab>,
    pub active: String,
    pub window: Option<Geometry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Tab {
    pub path: String,
    pub message: String,
    #[serde(default)]
    pub layout: Option<serde_json::Value>,
    #[serde(default)]
    pub shown: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Geometry {
    #[serde(rename = "x")]
    pub left: i32,
    #[serde(rename = "y")]
    pub top: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum CloseState {
    #[default]
    Open,
    Requested,
    Claimed,
    Allowed,
}

fn decode_session(bytes: &[u8]) -> Session {
    serde_json::from_slice(bytes).unwrap_or_else(|error| {
        tracing::warn!(%error, "Unable to read saved session");
        Session::default()
    })
}
fn unreadable_session(error: &std::io::Error) -> Session {
    if error.kind() != std::io::ErrorKind::NotFound {
        tracing::warn!(%error, "Unable to load saved session");
    }
    Session::default()
}

#[derive(Default)]
pub struct Store {
    state: Mutex<Session>,
    path: Option<PathBuf>,
    closing: Mutex<CloseState>,
    unsaved: Mutex<Vec<String>>,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let state = match std::fs::read(&path) {
            Ok(bytes) => decode_session(&bytes),
            Err(error) => unreadable_session(&error),
        };
        Self {
            state: Mutex::new(state),
            path: Some(path),
            closing: Mutex::default(),
            unsaved: Mutex::default(),
        }
    }

    pub fn get(&self) -> Session {
        lock_recovering(&self.state).clone()
    }

    pub fn update(&self, tabs: Vec<Tab>, active: String) {
        let mut state = lock_recovering(&self.state);
        state.tabs = tabs;
        state.active = active;
    }

    pub fn geometry(&self, geometry: Geometry) {
        lock_recovering(&self.state).window = Some(geometry);
    }

    fn advance_close(&self, from: CloseState, to: CloseState) -> bool {
        let mut closing = lock_recovering(&self.closing);
        if *closing != from {
            return false;
        }
        *closing = to;
        true
    }

    pub fn begin_close(&self) -> bool {
        self.advance_close(CloseState::Open, CloseState::Requested)
    }

    pub fn claim_close(&self) -> bool {
        self.advance_close(CloseState::Requested, CloseState::Claimed)
    }

    pub fn allow_close(&self) -> bool {
        self.advance_close(CloseState::Claimed, CloseState::Allowed)
    }

    pub fn close_allowed(&self) -> bool {
        *lock_recovering(&self.closing) == CloseState::Allowed
    }

    pub fn unsaved(&self, paths: Vec<String>) {
        *lock_recovering(&self.unsaved) = paths;
    }

    pub fn unsaved_paths(&self) -> Vec<String> {
        lock_recovering(&self.unsaved).clone()
    }

    pub fn cancel_close(&self) {
        *lock_recovering(&self.closing) = CloseState::Open;
    }

    pub fn save(&self) -> Result<()> {
        let state = lock_recovering(&self.state);
        if let Some(path) = &self.path {
            crate::settings::write_json(path, &*state)?;
        }
        Ok(())
    }
}
