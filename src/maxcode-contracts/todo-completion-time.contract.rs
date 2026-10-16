//! Completion time survives edits and resets when reopened.
use super::*;
use crate::db::test_helpers::fresh_in_memory_db;

#[tokio::test]
async fn completion_timestamp_lifecycle() {
    let db = fresh_in_memory_db().await;
    let conn = &db.conn;
    let state = call(
        conn,
        TodoRequest {
            action: "create".into(),
            title: Some("Completion time".into()),
            content: Some("Check timestamp".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let mut item = state.todos[0].clone();
    assert!(item.completed_at.is_none());
    for action in ["complete", "update", "reopen", "complete"] {
        let previous = item.completed_at.clone();
        let state = call(
            conn,
            TodoRequest {
                action: action.into(),
                id: Some(item.id.clone()),
                revision: Some(item.revision),
                title: Some(item.title.clone()),
                content: Some("Edited content".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        item = state.todos.into_iter().find(|t| t.id == item.id).unwrap();
        match action {
            "complete" => {
                assert_eq!(item.completed_at.as_ref(), Some(&item.updated_at));
                assert!(
                    chrono::DateTime::parse_from_rfc3339(item.completed_at.as_ref().unwrap())
                        .is_ok()
                );
            }
            "update" => assert_eq!(item.completed_at, previous),
            "reopen" => assert!(item.completed_at.is_none()),
            _ => unreachable!(),
        }
    }
}
