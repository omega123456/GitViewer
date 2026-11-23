pub const OLD_PREFIX: &str = "a/";
pub const NEW_PREFIX: &str = "b/";
const QUOTE: char = '"';
const BACKSLASH: char = '\\';

fn needs_quoting(character: char) -> bool {
    character == QUOTE || character == BACKSLASH || character.is_ascii_control()
}
fn escape(character: char) -> String {
    match character {
        QUOTE => "\\\"".into(),
        BACKSLASH => "\\\\".into(),
        '\x07' => "\\a".into(),
        '\x08' => "\\b".into(),
        '\t' => "\\t".into(),
        '\n' => "\\n".into(),
        '\x0b' => "\\v".into(),
        '\x0c' => "\\f".into(),
        '\r' => "\\r".into(),
        control if control.is_ascii_control() => format!("\\{:03o}", u32::from(control)),
        other => other.into(),
    }
}
pub fn always_quoted(prefix: &str, path: &str) -> String {
    let escaped: String = path.chars().map(escape).collect();
    format!("{QUOTE}{prefix}{escaped}{QUOTE}")
}
pub fn quote_path(prefix: &str, path: &str) -> String {
    if path.chars().any(needs_quoting) {
        return always_quoted(prefix, path);
    }
    format!("{prefix}{path}")
}
pub fn diff_header(old: &str, new: &str) -> String {
    format!("diff --git {old} {new}")
}
