use super::*;
use crate::db::entities::folder::FolderKind;

#[tokio::test]
async fn chat_runs_get_fresh_hidden_non_git_directories() {
    let db = crate::db::test_helpers::fresh_in_memory_db().await;
    let data = tempfile::tempdir().unwrap();
    let first = resolve_chat_cwd(&db, data.path()).await.unwrap();
    let second = resolve_chat_cwd(&db, data.path()).await.unwrap();
    assert_ne!(first.folder_id, second.folder_id);
    assert_ne!(first.working_dir, second.working_dir);
    for cwd in [first, second] {
        assert!(Path::new(&cwd.working_dir).starts_with(data.path().join("chat-sessions")));
        assert!(Path::new(&cwd.working_dir).is_dir());
        assert!(!Path::new(&cwd.working_dir).join(".git").exists());
        assert!(cwd.worktree_folder_id.is_none());
        let folder = get_folder_core(&db, cwd.folder_id).await.unwrap();
        assert_eq!(folder.kind, FolderKind::Chat);
    }
}
