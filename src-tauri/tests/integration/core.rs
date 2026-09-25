use gitviewer_lib::{
    ai, diff,
    error::Error,
    git::{self, detect},
    graph::{lanes, Commit},
    settings, status,
};

#[test]
fn environment_versions_and_error_categories() {
    for version in ["git version 2.38.0", "2.50.1.windows.1", "3.0.0"] {
        assert!(detect::version_supported(version));
    }
    for version in ["2.37.9", "1.99.0", "invalid", "2"] {
        assert!(!detect::version_supported(version));
    }
    assert_eq!(
        Error::git("Authentication failed".into()).category,
        "authentication"
    );
    assert_eq!(
        Error::git("Could not resolve host".into()).category,
        "network"
    );
    assert_eq!(Error::git("hook rejected".into()).category, "refused");
    assert_eq!(
        Error::from(std::io::Error::other("failure")).message,
        "failure"
    );
    assert!(git::Output {
        code: 1,
        bytes: b"reason".to_vec(),
        stderr: " detail".into()
    }
    .accept(&[0])
    .unwrap_err()
    .message
    .contains("reason detail"));
}
#[tokio::test]
async fn missing_git_is_a_value() {
    let absent = detect::with(|| async { None }).await;
    assert!(!absent.found);
    assert!(!absent.supported);
    assert!(absent.version.is_empty());
    let present = detect::with(|| async { Some("git version 2.50.1".to_string()) }).await;
    assert!(present.found);
    assert!(present.supported);
    assert_eq!(present.version, "2.50.1");
    assert!(detect::binary_version("gitviewer-nonexistent-test-binary")
        .await
        .is_none());
    assert!(detect::environment().await.found);
}
#[test]
fn porcelain_handles_all_records_and_odd_paths() {
    let bytes=b"# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -3\x001 MM N... 100644 100644 100644 a b folder/file name.txt\x002 RM N... 100644 100644 100644 a b R100 new\0old\0? new\nfile\0u UU N... 100644 100644 100644 100644 a b c conflict\0";
    let s = status::parse(bytes).unwrap();
    assert_eq!(s.branch, "main");
    assert_eq!(s.ahead, Some(2));
    assert_eq!(s.behind, Some(3));
    assert_eq!(s.entries[0].path(), "folder/file name.txt");
    assert_eq!(s.entries[0].index(), "M");
    assert_eq!(s.entries[1].original_path(), Some("old"));
    assert_eq!(
        s.entries[1],
        status::Entry::Renamed {
            path: "new".into(),
            original_path: "old".into(),
            score: "R100".into(),
            index: "R".into(),
            worktree: "M".into(),
        }
    );
    assert_eq!(s.entries[2].path(), "new\nfile");
    assert_eq!(s.entries[2].worktree(), "?");
    assert!(s.conflicted);
    assert_eq!(s.entries[3].worktree(), "C");
    assert_eq!(s.entries[3].original_path(), None);
    assert_eq!(
        s.entries[3],
        status::Entry::Unmerged {
            path: "conflict".into(),
            stage: "UU".into(),
            modes: [
                "100644".into(),
                "100644".into(),
                "100644".into(),
                "100644".into()
            ],
            hashes: ["a".into(), "b".into(), "c".into()],
            index: "C".into(),
            worktree: "C".into(),
        }
    );
    let detached = status::parse(b"# branch.head (detached)\0").unwrap();
    assert!(detached.upstream.is_none());
    for invalid in [
        b"1 bad\0".as_slice(),
        b"2 RM N... 100644 100644 100644 a b R100 new\0",
        b"x bad\0",
        b"\xff",
    ] {
        assert!(status::parse(invalid).is_err());
    }
}
#[test]
fn diffs_preserve_ranges_words_modes_and_newlines() {
    let text="diff --git a/a b/a\nold mode 100644\nnew mode 100755\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n context\n-old text\n\\ No newline at end of file\n+new text\n\\ No newline at end of file\n";
    let parsed = diff::parse(text, "a", "unstaged").unwrap();
    assert_eq!(parsed.old_mode.as_deref(), Some("100644"));
    assert_eq!(parsed.new_mode.as_deref(), Some("100755"));
    assert!(parsed.hunks[0].lines[1].marks.iter().any(|m| m.changed));
    assert!(parsed.hunks[0].lines[2].no_newline);
    assert!(diff::patch("a", &parsed.hunks[0])
        .unwrap()
        .contains("\\ No newline at end of file"));
    assert!(diff::patch("a\n", &parsed.hunks[0]).is_err());
    assert!(diff::parse("@@ -x +1 @@\n", "a", "staged").is_err());
    assert!(diff::parse("@@ -1,x +1 @@\n", "a", "staged").is_err());
    assert!(diff::parse("@@ malformed\n", "a", "staged").is_err());
    assert!(
        diff::parse("Binary files a and b differ\n", "a", "staged")
            .unwrap()
            .binary
    );
    assert!(diff::is_image("example.PNG"));
    assert!(!diff::is_image("example.rs"));
    let h = diff::parse("@@ -0,0 +1 @@\n+hello\n", "x", "staged").unwrap();
    assert_eq!(h.hunks[0].new_count, 1);
}
#[test]
fn image_headers_yield_pixel_dimensions() {
    let size = |width: u32, height: u32| Some(diff::Dimensions { width, height });
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    png.extend_from_slice(&320u32.to_be_bytes());
    png.extend_from_slice(&180u32.to_be_bytes());
    assert_eq!(diff::dimensions(&png), size(320, 180));
    let mut gif = b"GIF89a".to_vec();
    gif.extend_from_slice(&64u16.to_le_bytes());
    gif.extend_from_slice(&48u16.to_le_bytes());
    assert_eq!(diff::dimensions(&gif), size(64, 48));
    let mut bmp = b"BM".to_vec();
    bmp.resize(18, 0);
    bmp.extend_from_slice(&12i32.to_le_bytes());
    bmp.extend_from_slice(&(-9i32).to_le_bytes());
    assert_eq!(diff::dimensions(&bmp), size(12, 9));
    let mut ico = b"\0\0\x01\0\0\0".to_vec();
    ico.extend_from_slice(&[0, 16]);
    assert_eq!(diff::dimensions(&ico), size(256, 16));
    let mut jpeg = b"\xff\xd8\xff\xd8\xff\xe0\0\x04ab\xff\xc4\0\x03a\xff\xc0\0\x11\x08".to_vec();
    jpeg.extend_from_slice(&180u16.to_be_bytes());
    jpeg.extend_from_slice(&320u16.to_be_bytes());
    assert_eq!(diff::dimensions(&jpeg), size(320, 180));
    let mut extended = b"RIFF\0\0\0\0WEBPVP8X".to_vec();
    extended.resize(24, 0);
    extended.extend_from_slice(&[63, 0, 0, 79, 0, 0]);
    assert_eq!(diff::dimensions(&extended), size(64, 80));
    let mut lossless = b"RIFF\0\0\0\0WEBPVP8L".to_vec();
    lossless.resize(21, 0);
    lossless.extend_from_slice(&((79u32 << 14) | 63u32).to_le_bytes());
    assert_eq!(diff::dimensions(&lossless), size(64, 80));
    let mut lossy = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
    lossy.resize(26, 0);
    lossy.extend_from_slice(&64u16.to_le_bytes());
    lossy.extend_from_slice(&80u16.to_le_bytes());
    assert_eq!(diff::dimensions(&lossy), size(64, 80));
    for unsupported in [
        b"RIFF\0\0\0\0WEBPXXXX".as_slice(),
        b"<svg></svg>",
        b"\xff\xd8\xff",
        b"\x89PNG\r\n\x1a\n",
        b"",
    ] {
        assert_eq!(diff::dimensions(unsupported), None);
    }
}
#[test]
fn settings_roundtrip_and_invalid_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings/settings.json");
    let defaults = settings::read(&path);
    assert_eq!(defaults.theme, "system");
    assert_eq!(settings::write(&path, defaults.clone()).unwrap(), defaults);
    assert_eq!(settings::read(&path), defaults);
    let mut invalid = defaults.clone();
    invalid.theme = "invalid".into();
    assert!(settings::write(&path, invalid).is_err());
    let mut always = defaults.clone();
    always.smart_commit = "always".into();
    assert_eq!(settings::write(&path, always.clone()).unwrap(), always);
    assert_eq!(defaults.max_file_tabs, 8);
    for max_file_tabs in [3, 20] {
        let limit = settings::Settings {
            max_file_tabs,
            ..defaults.clone()
        };
        assert_eq!(settings::write(&path, limit.clone()).unwrap(), limit);
    }
    for max_file_tabs in [2, 21] {
        let limit = settings::Settings {
            max_file_tabs,
            ..defaults.clone()
        };
        assert!(settings::write(&path, limit).is_err());
    }
    let mut unknown = defaults;
    unknown.smart_commit = "sometimes".into();
    assert_eq!(
        settings::write(&path, unknown).unwrap_err().message,
        "Invalid settings"
    );
    std::fs::write(&path, "invalid").unwrap();
    assert_eq!(settings::read(&path).density, "comfortable");
}
#[test]
fn zoom_is_limited_to_the_presets_and_applies_to_the_main_window() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let defaults = settings::read(&path);
    assert_eq!(defaults.zoom, 100);
    for zoom in settings::ZOOM_LEVELS {
        let preset = settings::Settings {
            zoom,
            ..defaults.clone()
        };
        assert_eq!(settings::write(&path, preset).unwrap().zoom, zoom);
    }
    let odd = settings::Settings {
        zoom: 105,
        ..defaults
    };
    assert!(settings::write(&path, odd).is_err());
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    settings::apply_zoom(app.handle(), 125).unwrap();
    tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    settings::apply_zoom(app.handle(), 125).unwrap();
}
#[test]
fn settings_carry_ai_defaults_validation_and_a_legacy_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(
        &path,
        r#"{"theme":"dark","density":"compact","diffMode":"unified","updateCheckInterval":"7d","installUpdateOnQuit":false,"ai":{"enabled":true}}"#,
    )
    .unwrap();
    let legacy = settings::read(&path);
    assert_eq!(legacy.theme, "dark");
    assert_eq!(legacy.smart_commit, "ask");
    assert_eq!(legacy.ai, settings::Ai::default());
    assert_eq!(legacy.ai.prompt, settings::DEFAULT_PROMPT);
    let mut configured = legacy.clone();
    configured.ai.base_url = "https://api.example.invalid/v1".into();
    configured.ai.model = "tiny".into();
    assert_eq!(
        settings::write(&path, configured.clone()).unwrap(),
        configured
    );
    assert_eq!(settings::read(&path), configured);
    for rejected in ["not a url", "file:///etc/passwd", "ftp://example.invalid"] {
        let mut invalid = configured.clone();
        invalid.ai.base_url = rejected.into();
        assert_eq!(
            settings::write(&path, invalid).unwrap_err().message,
            "Invalid endpoint"
        );
    }
}
#[test]
fn settings_response_reports_key_presence_without_the_key() {
    ai::set_key("secret-key-value").unwrap();
    assert!(ai::key_stored());
    let response = serde_json::to_value(settings::Response {
        settings: settings::Settings::default(),
        key_stored: ai::key_stored(),
    })
    .unwrap();
    assert_eq!(response["keyStored"], true);
    assert_eq!(response["theme"], "system");
    assert!(response["ai"]["enabled"].is_null());
    assert!(!response.to_string().contains("secret-key-value"));
    ai::set_key("").unwrap();
    assert!(!ai::key_stored());
    assert_eq!(ai::key().unwrap(), None);
    assert_eq!(
        serde_json::to_value(settings::Response {
            settings: settings::Settings::default(),
            key_stored: ai::key_stored(),
        })
        .unwrap()["keyStored"],
        false
    );
}
#[tokio::test]
async fn ai_material_chooses_its_source_and_budget() {
    let (dir, handle) = super::workflows::fixture().await;
    super::workflows::base(&dir, &handle).await;
    let root = dir.path().to_path_buf();
    assert_eq!(
        ai::material(&root).await.unwrap_err().message,
        "There are no changes to describe"
    );
    std::fs::write(root.join("file.txt"), "one\ntwo\nfour\n").unwrap();
    let unstaged = ai::material(&root).await.unwrap();
    assert_eq!(unstaged.source, ai::Source::WorkingTree);
    assert_eq!(unstaged.detail, ai::Detail::Patch);
    assert!(unstaged.text.contains("+four"));
    super::workflows::command(&root, &["add", "file.txt"]).await;
    let staged = ai::material(&root).await.unwrap();
    assert_eq!(staged.source, ai::Source::Index);
    assert_eq!(staged.detail, ai::Detail::Patch);
    let large: String = std::iter::repeat_n("a line of change\n", 12_000).collect();
    assert!(large.chars().count() > ai::DIFF_BUDGET);
    std::fs::write(root.join("file.txt"), &large).unwrap();
    super::workflows::command(&root, &["add", "file.txt"]).await;
    let compacted = ai::material(&root).await.unwrap();
    assert_eq!(compacted.source, ai::Source::Index);
    assert_eq!(compacted.detail, ai::Detail::Compacted);
    assert!(compacted.text.contains("file.txt"));
    assert!(compacted.text.chars().count() <= ai::DIFF_BUDGET);
    super::workflows::command(&root, &["reset"]).await;
    let unstaged_compacted = ai::material(&root).await.unwrap();
    assert_eq!(unstaged_compacted.source, ai::Source::WorkingTree);
    assert_eq!(unstaged_compacted.detail, ai::Detail::Compacted);
}
#[tokio::test]
async fn ai_material_ignores_repository_diff_configuration() {
    let (dir, handle) = super::workflows::fixture().await;
    super::workflows::base(&dir, &handle).await;
    let root = dir.path().to_path_buf();
    super::workflows::command(&root, &["config", "diff.noprefix", "true"]).await;
    super::workflows::command(
        &root,
        &["config", "diff.external", "gitviewer-missing-external-diff"],
    )
    .await;
    std::fs::write(root.join("file.txt"), "one\ntwo\nfour\n").unwrap();
    let material = ai::material(&root).await.unwrap();
    assert!(material
        .text
        .starts_with("diff --git a/file.txt b/file.txt"));
    assert!(material.text.contains("+four"));
}
fn patch_section(path: &str, lines: &[String]) -> String {
    let body: String = lines.iter().map(|line| format!("+{line}\n")).collect();
    format!(
        "diff --git a/{path} b/{path}\nindex 1111111..2222222 100644\n--- a/{path}\n+++ b/{path}\n@@ -0,0 +1,{} @@\n{body}",
        lines.len()
    )
}
fn repeated(line: &str, count: usize) -> Vec<String> {
    std::iter::repeat_n(line.to_string(), count).collect()
}
#[test]
fn ai_compact_reduces_noise_files_to_their_header_first() {
    let code = patch_section("src/main.rs", &repeated("fn main() {}", 3));
    let lock = patch_section("pnpm-lock.yaml", &repeated("  version: 1.0.0", 5000));
    let patch = format!("{lock}{code}");
    let compacted = ai::compact(&patch, 2000);
    assert!(compacted.chars().count() <= 2000);
    assert!(compacted.ends_with(&code));
    assert!(compacted.contains("+++ b/pnpm-lock.yaml\n"));
    assert!(compacted.contains("… 5000 changed lines omitted"));
    assert!(!compacted.contains("version: 1.0.0"));
}
#[test]
fn ai_compact_shares_the_budget_and_outlines_what_it_cuts() {
    let small = patch_section("src/small.rs", &repeated("fn small() {}", 4));
    let mut lines = repeated("    let helper = 1;", 2000);
    lines.extend([
        "fn late_function_name() {".to_string(),
        "}".to_string(),
        String::new(),
    ]);
    let large = patch_section("src/large.rs", &lines);
    let compacted = ai::compact(&format!("{small}{large}"), 4000);
    assert!(compacted.chars().count() <= 4000);
    assert!(compacted.starts_with(&small));
    assert!(compacted.contains("+++ b/src/large.rs\n@@ -0,0 +1,2003 @@\n+    let helper = 1;\n"));
    let (_, outline) = compacted
        .split_once("more changed lines omitted, outline follows\n")
        .unwrap();
    assert_eq!(outline, "+fn late_function_name() {\n");
    assert!(compacted.matches("let helper").count() < 2000);
}
#[test]
fn ai_compact_never_exceeds_the_budget() {
    let patch: String = (0..200)
        .map(|index| {
            patch_section(
                &format!("src/file{index}.rs"),
                &repeated("fn body() {}", 40),
            )
        })
        .chain(
            (0..300).map(|index| patch_section(&format!("vendor/{index}.lock"), &repeated("x", 2))),
        )
        .collect();
    let compacted = ai::compact(&patch, 2000);
    assert!(compacted.chars().count() <= 2000);
    assert!(compacted.ends_with("… the remaining files are omitted\n"));
}
#[test]
fn ai_prompt_states_the_source_and_the_detail() {
    let material = |source, detail| ai::Material {
        text: "PATCH BODY".into(),
        source,
        detail,
    };
    let staged = ai::prompt(
        "Describe it.",
        &material(ai::Source::Index, ai::Detail::Patch),
    );
    assert!(staged.starts_with("Describe it."));
    assert!(staged.contains("The staged patch follows."));
    assert!(staged.ends_with("PATCH BODY"));
    assert!(
        ai::prompt("   ", &material(ai::Source::Index, ai::Detail::Patch))
            .starts_with(settings::DEFAULT_PROMPT)
    );
    let compacted = ai::prompt("t", &material(ai::Source::Index, ai::Detail::Compacted));
    assert!(
        compacted.contains("The staged patch exceeds the budget, so a compacted patch follows.")
    );
    assert!(compacted.contains("Write exactly one commit message from what is shown."));
    assert!(
        ai::prompt("t", &material(ai::Source::WorkingTree, ai::Detail::Patch))
            .contains("Nothing is staged, so the unstaged working tree patch follows.")
    );
    assert!(ai::prompt(
        "t",
        &material(ai::Source::WorkingTree, ai::Detail::Compacted)
    )
    .contains("Nothing is staged and the working tree patch exceeds the budget"));
}
#[test]
fn lane_assignment_handles_merges_and_termination() {
    let make = |hash: &str, parents: Vec<&str>| Commit {
        hash: hash.into(),
        parents: parents.into_iter().map(String::from).collect(),
        author: "A".into(),
        timestamp: 0,
        subject: hash.into(),
        refs: String::new(),
        lane: 0,
        segments: Vec::new(),
    };
    let mut commits = vec![
        make("merge", vec!["left", "right"]),
        make("left", vec!["base"]),
        make("right", vec!["base"]),
        make("base", vec![]),
    ];
    let mut active = Vec::new();
    lanes(&mut commits, &mut active);
    assert_eq!(commits[2].lane, 1);
    assert_eq!(commits[0].segments.len(), 2);
    assert!(active.is_empty());
}

#[tokio::test]
async fn infrastructure_errors_keep_their_reason_and_category() {
    use gitviewer_lib::error::Error;
    let json = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
    assert_eq!(Error::from(json).category, "unexpected");
    let notification = notify::Error::generic("watch unavailable");
    assert!(Error::from(notification)
        .message
        .contains("watch unavailable"));
    let runtime = tauri::Error::Io(std::io::Error::other("runtime unavailable"));
    assert!(Error::from(runtime).message.contains("runtime unavailable"));
    let opener = tauri_plugin_opener::Error::UnknownProgramName("missing editor".into());
    let mapped = Error::from(opener);
    assert_eq!(mapped.category, "unexpected");
    assert!(mapped.message.contains("missing editor"));
    let task = tokio::spawn(std::future::pending::<()>());
    task.abort();
    assert_eq!(Error::from(task.await.unwrap_err()).category, "unexpected");
}
