use crate::git::NUL_BYTE;
use std::{
    io::{ErrorKind, Result},
    path::Path,
};

fn absent_as<Value>(result: Result<Value>, absent: Value) -> Result<Value> {
    match result {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(absent),
        other => other,
    }
}
pub fn read_optional(path: &Path) -> Result<Option<Vec<u8>>> {
    absent_as(std::fs::read(path).map(Some), None)
}
pub fn read_if_present(path: &Path) -> Result<Vec<u8>> {
    absent_as(std::fs::read(path), Vec::new())
}
pub fn size_if_present(path: &Path) -> Result<usize> {
    let size = std::fs::metadata(path)
        .map(|metadata| usize::try_from(metadata.len()).unwrap_or(usize::MAX));
    absent_as(size, 0)
}
pub fn remove_if_present(path: &Path) -> Result<()> {
    absent_as(std::fs::remove_file(path), ())
}
pub fn is_binary(bytes: &[u8]) -> bool {
    bytes.contains(&NUL_BYTE)
}
pub fn count_lines(text: &str) -> usize {
    text.lines().count()
}
pub fn file_name_of(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
