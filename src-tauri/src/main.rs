#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(
    clippy::min_ident_chars,
    clippy::as_conversions,
    clippy::cognitive_complexity
)]

fn main() {
    gitviewer_lib::run();
}
