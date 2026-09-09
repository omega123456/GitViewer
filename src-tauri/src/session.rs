use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU8, Ordering},
        Mutex,
    },
};

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
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

#[derive(Default)]
pub struct Store {
    state: Mutex<Session>,
    path: Option<PathBuf>,
    closing: AtomicU8,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let state = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                tracing::warn!(%error, "Unable to read saved session");
                Session::default()
            }),
            Err(error) => {
                if error.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(%error, "Unable to load saved session");
                }
                Session::default()
            }
        };
        Self {
            state: Mutex::new(state),
            path: Some(path),
            closing: AtomicU8::new(0),
        }
    }

    pub fn get(&self) -> Session {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn update(&self, tabs: Vec<Tab>, active: String) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.tabs = tabs;
        state.active = active;
    }

    pub fn geometry(&self, geometry: Geometry) {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).window = Some(geometry);
    }

    pub fn begin_close(&self) -> bool {
        self.closing
            .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn allow_close(&self) -> bool {
        self.closing
            .compare_exchange(1, 2, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn close_allowed(&self) -> bool {
        self.closing.load(Ordering::SeqCst) == 2
    }

    pub fn cancel_close(&self) {
        self.closing.store(0, Ordering::SeqCst);
    }

    pub fn save(&self) -> Result<()> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(path) = &self.path {
            crate::settings::write_json(path, &*state)?;
        }
        Ok(())
    }
}
