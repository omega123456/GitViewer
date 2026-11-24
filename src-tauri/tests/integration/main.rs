#![deny(
    clippy::min_ident_chars,
    clippy::as_conversions,
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::cognitive_complexity,
    clippy::excessive_nesting,
    clippy::too_many_lines
)]

mod core;
mod support;
mod workflows;

mod edit;
mod helpers;
mod ipc;
mod lines;

mod persistence;

mod updater;

mod worktree;

mod variants;
