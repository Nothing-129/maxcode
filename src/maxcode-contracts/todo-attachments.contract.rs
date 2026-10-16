//! Markdown URLs persist; obsolete embedded bytes are removed.
use super::*;
use crate::db::test_helpers::fresh_in_memory_db;

#[tokio::test]
async fn markdown_urls_survive_create_reload_and_update() {
    let db = fresh_in_memory_db().await;
    let content = "Review screenshot\n\n![shot](https://files.example.test/shot.png)".to_string();
    let result = call(
        &db.conn,
        TodoRequest {
            action: "create".into(),
            title: Some("Attachment test".into()),
            content: Some(content.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let todo = &result.todos[0];
    assert_eq!(todo.content, content);
    let updated = call(
        &db.conn,
        TodoRequest {
            action: "update".into(),
            id: Some(todo.id.clone()),
            revision: Some(todo.revision),
            title: Some("Updated".into()),
            content: Some(content.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(updated.todos[0].content, content);
    let reloaded = call(
        &db.conn,
        TodoRequest {
            action: "state".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(reloaded.todos[0].content, content);
}

#[test]
fn old_clients_cannot_write_embedded_attachments() {
    assert!(required_todo_content(Some("Text\n<!-- maxcode-todo-attachments:v1 -->\n[]")).is_err());
    assert!(required_todo_content(Some(&"x".repeat(250_001))).is_err());
}

#[tokio::test]
async fn migration_removes_only_embedded_tails_and_preserves_url_metadata() {
    use crate::db::migration::Migrator;
    use sea_orm_migration::MigratorTrait;
    let db = fresh_in_memory_db().await;
    let rollback_steps = Migrator::migrations()
        .iter()
        .rev()
        .position(|migration| {
            migration.name() == "m20261016_000002_remove_embedded_todo_attachments"
        })
        .expect("attachment cleanup migration must be registered") as u32
        + 1;
    Migrator::down(&db.conn, Some(rollback_steps))
        .await
        .unwrap();
    let markdown = "![new](https://files.example.test/new.png)";
    for (id, scope, body) in [
        ("text", "personal", format!("{markdown}\n\n<!-- maxcode-todo-attachments:v1 -->\n[{{\"name\":\"old\",\"data\":\"data:text/plain;base64,YQ==\"}}]")),
        ("only", "team-a", "<!-- maxcode-todo-attachments:v1 -->\n[]".into()),
        ("new", "personal", markdown.into()),
    ] {
        db.conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO maxcode_todo_item (id,scope_id,title,content,status,creator_id,revision,created_at,updated_at) VALUES (?,?,'Keep title',?,'unclaimed','personal',7,'before','before')",
            vec![id.into(), scope.into(), body.into()],
        )).await.unwrap();
    }
    db.conn.execute_unprepared("INSERT INTO maxcode_todo_attachment VALUES ('new','personal','new.png','https://files.example.test/new.png',123,'image/png','before')").await.unwrap();
    Migrator::up(&db.conn, None).await.unwrap();
    for (id, expected, revision) in [
        ("text", markdown, 8i64),
        ("only", "", 8),
        ("new", markdown, 7),
    ] {
        let row = db
            .conn
            .query_one(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "SELECT content,title,revision,updated_at FROM maxcode_todo_item WHERE id=?",
                [id.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<String>("", "content").unwrap(), expected);
        assert_eq!(row.try_get::<String>("", "title").unwrap(), "Keep title");
        assert_eq!(row.try_get::<i64>("", "revision").unwrap(), revision);
        assert_eq!(
            row.try_get::<String>("", "updated_at").unwrap() == "before",
            id == "new"
        );
    }
    assert!(db
        .conn
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id FROM maxcode_todo_attachment WHERE id='new'"
        ))
        .await
        .unwrap()
        .is_some());
    // Re-running the destructive migration is harmless once its marker is gone.
    Migrator::down(&db.conn, Some(rollback_steps))
        .await
        .unwrap();
    Migrator::up(&db.conn, None).await.unwrap();
    let row = db
        .conn
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT revision FROM maxcode_todo_item WHERE id='text'",
        ))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.try_get::<i64>("", "revision").unwrap(), 8);
}
