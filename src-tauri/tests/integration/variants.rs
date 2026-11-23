use gitviewer_lib::{
    actions::FilesAction,
    branch::SyncAction,
    diff::{DiffSource, LineKind},
    settings::UpdateInterval,
};
use serde_json::json;

#[test]
fn diff_sources_and_line_kinds_keep_their_wire_names() {
    for (name, source) in [
        ("staged", DiffSource::Staged),
        ("unstaged", DiffSource::Unstaged),
        ("file", DiffSource::File),
        ("commit", DiffSource::Commit),
        ("stash", DiffSource::Stash),
        ("compare", DiffSource::Compare),
    ] {
        assert_eq!(DiffSource::parse(name).unwrap(), source);
        assert_eq!(serde_json::to_value(source).unwrap(), json!(name));
    }
    for (name, kind) in [
        ("add", LineKind::Add),
        ("remove", LineKind::Remove),
        ("context", LineKind::Context),
    ] {
        assert_eq!(serde_json::to_value(kind).unwrap(), json!(name));
    }
    assert!(DiffSource::Stash.is_revision());
    assert!(!DiffSource::Compare.is_revision());
    assert!(DiffSource::Staged.is_uncommitted());
    assert!(!DiffSource::File.is_uncommitted());
}

#[test]
fn file_and_sync_actions_parse_their_command_names() {
    for (name, action) in [
        ("stage", FilesAction::Stage),
        ("unstage", FilesAction::Unstage),
        ("revert", FilesAction::Revert),
        ("discard", FilesAction::Discard),
    ] {
        assert_eq!(FilesAction::parse(name).unwrap(), action);
    }
    for (name, action) in [
        ("fetch", SyncAction::Fetch),
        ("pull", SyncAction::Pull),
        ("push", SyncAction::Push),
    ] {
        assert_eq!(SyncAction::parse(name).unwrap(), action);
    }
    let unknown = FilesAction::parse("Stage").unwrap_err();
    assert_eq!(unknown.category, "refused");
    assert_eq!(unknown.message, "Unknown file action");
}

#[test]
fn update_intervals_parse_their_setting_values() {
    assert_eq!(UpdateInterval::parse("1d").unwrap(), UpdateInterval::Daily);
    assert_eq!(UpdateInterval::parse("off").unwrap().duration(), None);
    assert_eq!(
        UpdateInterval::Weekly.duration(),
        chrono::Duration::days(7).to_std().ok()
    );
    assert!(UpdateInterval::parse("2d").is_err());
}
