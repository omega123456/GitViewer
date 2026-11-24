use super::support::{base, command, fixture, record, Recorded};
use gitviewer_lib::{diff::quote, error::Error, fs, git, media};
use std::path::Path;

#[test]
fn file_helpers_tolerate_missing_files() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("missing.txt");
    let present = directory.path().join("present.txt");
    std::fs::write(&present, "one\ntwo\n").unwrap();
    assert_eq!(fs::read_optional(&missing).unwrap(), None);
    assert_eq!(
        fs::read_optional(&present).unwrap(),
        Some(b"one\ntwo\n".to_vec())
    );
    assert!(fs::read_if_present(&missing).unwrap().is_empty());
    assert_eq!(fs::size_if_present(&missing).unwrap(), 0);
    assert_eq!(fs::size_if_present(&present).unwrap(), 8);
    assert!(fs::read_optional(directory.path()).is_err());
    fs::remove_if_present(&missing).unwrap();
    fs::remove_if_present(&present).unwrap();
    assert!(!present.exists());
    assert!(fs::is_binary(b"a\0b"));
    assert!(!fs::is_binary(b"text"));
    assert_eq!(fs::count_lines("one\ntwo\nthree"), 3);
    assert_eq!(fs::file_name_of(Path::new("/projects/viewer")), "viewer");
    assert_eq!(fs::file_name_of(Path::new("/")), "");
}

#[test]
fn media_types_follow_the_extension() {
    assert_eq!(media::extension_of("photo.JPEG"), "jpeg");
    for (path, mime) in [
        ("a.png", "image/png"),
        ("a.jpg", "image/jpeg"),
        ("a.jpeg", "image/jpeg"),
        ("a.gif", "image/gif"),
        ("a.webp", "image/webp"),
        ("a.bmp", "image/bmp"),
        ("a.ico", "image/x-icon"),
        ("a.svg", "image/svg+xml"),
        ("a.avif", "image/avif"),
    ] {
        assert!(media::is_image(path));
        assert_eq!(media::mime(path), mime);
    }
    assert!(!media::is_image("notes.txt"));
    assert_eq!(media::mime("notes.txt"), "text/plain; charset=utf-8");
}

#[test]
fn paths_are_quoted_like_git() {
    assert_eq!(quote::quote_path("a/", "plain.txt"), "a/plain.txt");
    assert_eq!(
        quote::quote_path("b/", "say \"hi\"\\\t\x07\x08\n\x0b\x0c\r\x01"),
        "\"b/say \\\"hi\\\"\\\\\\t\\a\\b\\n\\v\\f\\r\\001\""
    );
    assert_eq!(quote::always_quoted("a/", "plain.txt"), "\"a/plain.txt\"");
    assert_eq!(
        quote::diff_header("a/old", "b/new"),
        "diff --git a/old b/new"
    );
}

#[test]
fn revision_and_reference_builders() {
    assert_eq!(git::nul_terminated(["a", "b"]), b"a\0b\0".to_vec());
    assert_eq!(
        git::nul_fields("a\0\0b\0").collect::<Vec<_>>(),
        vec!["a", "b"]
    );
    let remote = git::split_remote("origin/feature/x").unwrap();
    assert_eq!(remote.remote, "origin");
    assert_eq!(remote.branch, "feature/x");
    assert!(git::split_remote("main").is_none());
    assert_eq!(git::without_remote("origin/main"), "main");
    assert_eq!(git::without_remote("main"), "main");
    assert_eq!(git::range("a", "b"), "a..b");
    assert_eq!(git::symmetric_range("a", "b"), "a...b");
    assert_eq!(git::index_object("file.txt"), ":file.txt");
    assert_eq!(git::local_branch("main"), "refs/heads/main");
    assert_eq!(
        git::remote_branch("origin/main"),
        "refs/remotes/origin/main"
    );
    let unexpected = Error::unexpected("broken");
    assert_eq!(unexpected.category, "unexpected");
    assert_eq!(unexpected.message, "broken");
}

#[tokio::test]
async fn git_plumbing_checks_ancestors_refs_and_merge_conflicts() {
    let (_dir, repo) = fixture().await;
    let root = &repo.root;
    base(&repo).await;
    let first = command(root, &["rev-parse", "HEAD"])
        .await
        .trim()
        .to_owned();
    record(
        &repo,
        Recorded {
            path: "file.txt",
            body: "one\ntwo\nfour\n",
            message: "Second",
        },
    )
    .await;
    assert!(git::is_ancestor(root, &first, git::HEAD).await.unwrap());
    assert!(!git::is_ancestor(root, git::HEAD, &first).await.unwrap());
    assert!(git::ref_exists(root, &git::local_branch("main"))
        .await
        .unwrap());
    assert!(!git::ref_exists(root, &git::local_branch("absent"))
        .await
        .unwrap());
    assert_eq!(
        git::merge_conflicts(root, git::HEAD, &first).await.unwrap(),
        None
    );
    command(root, &["checkout", "-b", "side", &first]).await;
    record(
        &repo,
        Recorded {
            path: "file.txt",
            body: "one\ntwo\nsix\n",
            message: "Side",
        },
    )
    .await;
    let conflicts = git::merge_conflicts(root, "main", "side")
        .await
        .unwrap()
        .unwrap();
    assert!(conflicts.contains("file.txt"));
}

#[tokio::test]
async fn git_plumbing_lists_files_runs_pathspecs_and_checks_patches() {
    let (_dir, repo) = fixture().await;
    let root = &repo.root;
    base(&repo).await;
    assert_eq!(
        git::nul_list(root, &["ls-files", "-z"]).await.unwrap(),
        vec!["file.txt"]
    );
    assert!(git::untracked_in_stash(root, git::HEAD, &["--name-only"])
        .await
        .unwrap()
        .is_empty());
    std::fs::write(root.join("new.txt"), "new\n").unwrap();
    git::run_with_pathspec(root, &["add"], ["new.txt"])
        .await
        .unwrap();
    assert!(command(root, &["diff", "--cached", "--name-only"])
        .await
        .contains("new.txt"));
    let rejected = git::apply_checked(root, &["apply"], b"not a patch\n")
        .await
        .unwrap();
    assert!(!rejected.succeeded());
}
