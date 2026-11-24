use crate::lock::lock_recovering;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tokio::process::Command;

static EVENT_TARGET: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn trace_events(target: &Path) {
    *lock_recovering(&EVENT_TARGET) = Some(target.to_path_buf());
}

pub fn stop_tracing_events() {
    *lock_recovering(&EVENT_TARGET) = None;
}

pub(super) fn send_events_to_target(command: &mut Command) {
    if let Some(target) = lock_recovering(&EVENT_TARGET).as_ref() {
        command.env("GIT_TRACE2_EVENT", target);
    }
}
