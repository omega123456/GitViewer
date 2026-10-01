use super::workflows::{base, command, counted, fixture};
use gitviewer_lib::{
    history,
    lines::{count, numstat, working},
};
use serde_json::{json, to_value};

#[test]
fn numstat_reads_plain_renamed_and_binary_records() {
    let parsed = numstat("3\t1\tsrc/a.ts\0-\t-\tlogo.png\x000\t0\t\0old.ts\0new.ts\0\0");
    assert_eq!(
        to_value(parsed).unwrap(),
        json!({"src/a.ts":[3,1],"logo.png":null,"new.ts":[0,0]})
    );
    assert_eq!(count(b""), Some([0, 0]));
    assert_eq!(count(b"a\nb"), Some([2, 0]));
    assert_eq!(count(b"a\nb\n"), Some([2, 0]));
    assert_eq!(count(b"a\0b"), None);
}

#[tokio::test]
async fn working_lines_split_staged_unstaged_and_untracked() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    base(&dir, &repo).await;
    std::fs::write(root.join("moved.txt"), "keep\nkeep\n").unwrap();
    command(root, &["add", "moved.txt"]).await;
    command(root, &["commit", "-m", "Second"]).await;
    std::fs::write(root.join("file.txt"), "one\ntwo\nfour\nfive\n").unwrap();
    command(root, &["add", "file.txt"]).await;
    std::fs::write(root.join("file.txt"), "one\nfive\n").unwrap();
    command(root, &["mv", "moved.txt", "renamed.txt"]).await;
    std::fs::write(root.join("notes.md"), "a\nb\nc").unwrap();
    std::fs::write(root.join("blob.bin"), [0u8, 1, 2]).unwrap();
    std::fs::write(root.join("huge.txt"), "x\n".repeat(1_100_000)).unwrap();
    std::fs::create_dir(root.join("folder")).unwrap();
    std::fs::write(root.join("folder").join("deep.txt"), "x\n").unwrap();
    repo.refresh().await.unwrap();
    let lines = to_value(working(&repo).await.unwrap()).unwrap();
    assert_eq!(
        lines,
        json!({
            "staged": {"file.txt":[2,1],"renamed.txt":[0,0]},
            "unstaged": {
                "file.txt":[0,2],
                "notes.md":[3,0],
                "blob.bin":null,
                "folder/deep.txt":[1,0]
            }
        })
    );
    std::fs::write(root.join("notes.md"), "a\n").unwrap();
    std::fs::remove_file(root.join("blob.bin")).unwrap();
    repo.refresh().await.unwrap();
    let lines = working(&repo).await.unwrap();
    assert_eq!(lines.unstaged.get("notes.md"), Some(&Some([1, 0])));
    assert!(!lines.unstaged.contains_key("blob.bin"));
    assert!(!repo
        .untracked_lines
        .lock()
        .unwrap()
        .contains_key("blob.bin"));
}

#[tokio::test]
async fn working_lines_cover_an_unborn_branch_with_two_git_processes() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    std::fs::write(root.join("first.txt"), "1\n2\n").unwrap();
    command(root, &["add", "first.txt"]).await;
    std::fs::write(root.join("loose.txt"), "1\n").unwrap();
    repo.refresh().await.unwrap();
    let trace = root.join("..").join(format!(
        "{}-lines-trace.json",
        root.file_name().unwrap().to_string_lossy()
    ));
    std::env::set_var("GIT_TRACE2_EVENT", &trace);
    let mut result = None;
    let processes = counted(&trace, async {
        result = Some(working(&repo).await.unwrap());
    })
    .await;
    std::env::remove_var("GIT_TRACE2_EVENT");
    std::fs::remove_file(&trace).ok();
    assert_eq!(processes, 2);
    assert_eq!(
        to_value(result.unwrap()).unwrap(),
        json!({"staged":{"first.txt":[2,0]},"unstaged":{"loose.txt":[1,0]}})
    );
}

#[tokio::test]
async fn commit_files_carry_statuses_and_lines_from_one_diff() {
    let (dir, repo) = fixture().await;
    let root = dir.path();
    base(&dir, &repo).await;
    let first = history::files(&repo, "HEAD").await.unwrap();
    assert_eq!(
        to_value(first).unwrap(),
        json!({"statuses":{"file.txt":"A"},"lines":{"file.txt":[3,0]}})
    );
    std::fs::write(root.join("file.txt"), "one\nthree\nfour\n").unwrap();
    std::fs::write(root.join("logo.png"), [0u8, 9]).unwrap();
    command(root, &["add", "-A"]).await;
    command(root, &["commit", "-m", "Change"]).await;
    let second = history::files(&repo, "HEAD").await.unwrap();
    assert_eq!(
        to_value(second).unwrap(),
        json!({
            "statuses":{"file.txt":"M","logo.png":"A"},
            "lines":{"file.txt":[1,1],"logo.png":null}
        })
    );
}
