use super::*;

#[tokio::test]
async fn maxcode_unicode_and_renamed_task_files_keep_counts_and_open_their_patch() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    for args in [
        vec!["init", "-q"],
        vec!["config", "user.name", "Contract"],
        vec!["config", "user.email", "contract@example.invalid"],
        vec!["config", "core.quotePath", "true"],
        vec!["config", "commit.gpgsign", "false"],
    ] {
        assert!(run_git(path, &args).await.unwrap().status.success());
    }
    let old = "旧 文件.md";
    let new = "新 文件.md";
    std::fs::write(dir.path().join(old), "one\ntwo\nthree\nfour\nfive\n").unwrap();
    assert!(run_git(path, &["add", "-A"])
        .await
        .unwrap()
        .status
        .success());
    assert!(run_git(path, &["commit", "-qm", "base"])
        .await
        .unwrap()
        .status
        .success());
    std::fs::rename(dir.path().join(old), dir.path().join(new)).unwrap();
    std::fs::write(dir.path().join(new), "one\ntwo\nthree\nfour\nfive\nsix\n").unwrap();
    let files = diff_numstat_with_untracked(path, "HEAD").await.unwrap();
    assert_eq!(files.len(), 1, "{files:?}");
    assert!(files[0].file.contains(new), "{files:?}");
    assert_eq!(files[0].additions, 1);
    let patch = diff_patch_with_untracked(path, "HEAD", Some(&files[0].file))
        .await
        .unwrap();
    assert!(patch.contains(new) && patch.contains("+six"), "{patch}");
    // Reading the task preview must leave the real index alone.
    assert!(run_git(path, &["diff", "--cached", "--quiet"])
        .await
        .unwrap()
        .status
        .success());
}

#[test]
fn maxcode_moves_up_a_directory_keep_real_paths() {
    assert_eq!(
        numstat_rename_sides("docs/{sub => }/需求.md"),
        Some(("docs/sub/需求.md".to_string(), "docs/需求.md".to_string()))
    );
}
