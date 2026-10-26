//! Production verification is explicit and pending work remains visible.
use super::*;
use crate::db::test_helpers::fresh_in_memory_db;

#[tokio::test]
async fn verification_lifecycle() {
    let db = fresh_in_memory_db().await;
    let state = call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            content: Some("Verify release".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let mut item = state.todos[0].clone();
    for (action, status) in [
        ("complete", "pending_verification"),
        ("update", "pending_verification"),
        ("verify", "completed"),
        ("reopen", "unclaimed"),
    ] {
        let request = TodoRequest {
            action: action.into(),
            id: Some(item.id.clone()),
            revision: Some(item.revision),
            content: Some("Updated release notes".into()),
            ..Default::default()
        };
        let state = call(&db.conn, request.clone()).await.unwrap();
        assert_eq!(
            state.completed_pagination.total,
            if status == "completed" { 1 } else { 0 }
        );
        item = state.todos.into_iter().find(|t| t.id == item.id).unwrap();
        assert_eq!(item.status, status);
        assert!(
            call(&db.conn, request).await.is_err(),
            "stale revisions must fail"
        );
    }
    assert!(
        call(
            &db.conn,
            TodoRequest {
                action: "verify".into(),
                id: Some(item.id),
                revision: Some(item.revision),
                ..Default::default()
            }
        )
        .await
        .is_err(),
        "unfinished tasks cannot skip verification queue"
    );
}

#[tokio::test]
async fn verification_migration_preserves_existing_records() {
    use crate::db::migration::Migrator;
    use sea_orm_migration::MigratorTrait;
    let conn = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
    let previous_count = Migrator::migrations().len() as u32 - 1;
    Migrator::up(&conn, Some(previous_count)).await.unwrap();
    conn.execute_unprepared("INSERT INTO maxcode_todo_item (id,scope_id,title,content,status,assignee_id,creator_id,revision,source_url,created_at,updated_at,operation_id,due_date,priority,completed_at,codex_import_available) VALUES ('legacy','personal','title','body','completed','personal','personal',7,'/share#legacy','created','updated','operation','2026-10-26','urgent','finished',1)").await.unwrap();
    Migrator::up(&conn, None).await.unwrap();
    let state = call(
        &conn,
        TodoRequest {
            action: "state".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let item = &state.todos[0];
    assert_eq!(item.id, "legacy");
    assert_eq!(item.status, "completed");
    assert_eq!(item.revision, 7);
    assert_eq!(item.source_url.as_deref(), Some("/share#legacy"));
    assert_eq!(item.completed_at.as_deref(), Some("finished"));
    assert_eq!(item.due_date.as_deref(), Some("2026-10-26"));
    assert_eq!(item.priority.as_deref(), Some("urgent"));
    assert!(item.codex_import_available);
}

#[tokio::test]
async fn sidebar_status_changes_preserve_assignee_and_allow_direct_completion() {
    let db = fresh_in_memory_db().await;
    let state = call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            content: Some("Sidebar status".into()),
            assignee_id: Some("personal".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let mut item = state.todos[0].clone();
    for (action, status) in [
        ("complete", "pending_verification"),
        ("resume", "claimed"),
        ("finish", "completed"),
        ("reopen", "unclaimed"),
        ("claim", "claimed"),
        ("complete", "pending_verification"),
        ("finish", "completed"),
    ] {
        let state = call(
            &db.conn,
            TodoRequest {
                action: action.into(),
                id: Some(item.id.clone()),
                revision: Some(item.revision),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        item = state.todos.into_iter().find(|t| t.id == item.id).unwrap();
        assert_eq!(item.status, status);
        if action != "reopen" {
            assert_eq!(item.assignee_id.as_deref(), Some("personal"));
        }
        if status == "completed" {
            assert!(item.completed_at.is_some());
        }
        if action == "resume" {
            assert!(item.completed_at.is_none());
        }
    }
}
