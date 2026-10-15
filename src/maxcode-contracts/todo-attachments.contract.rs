//! Attachment bytes must round-trip through the same storage used by team members.
use super::*;
use crate::db::test_helpers::fresh_in_memory_db;

#[tokio::test]
async fn attachment_content_survives_create_reload_and_update() {
    let db = fresh_in_memory_db().await;
    // Larger than the former 250k text limit, as ordinary screenshots often are.
    let data = "YWFh".repeat(100_000);
    let content = format!(
        "Review screenshot\n\n<!-- maxcode-todo-attachments:v1 -->\n{}",
        serde_json::json!([{ "name": "shot.png", "data": format!("data:image/png;base64,{data}") }])
    );
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
    assert_eq!(todo_text_content(&content).trim(), "Review screenshot");
}

#[test]
fn attachment_only_content_never_becomes_a_title_prompt() {
    assert_eq!(
        todo_text_content("<!-- maxcode-todo-attachments:v1 -->\n[{\"data\":\"SECRET_BYTES\"}]"),
        ""
    );
    assert_eq!(todo_text_content("normal todo"), "normal todo");
}

#[test]
fn full_100_mib_attachment_is_accepted_but_one_extra_byte_is_rejected() {
    let encoded = STANDARD.encode(vec![0u8; TODO_ATTACHMENT_MAX_BYTES]);
    let mut content = format!(
        "<!-- maxcode-todo-attachments:v1 -->\n[{{\"name\":\"large.bin\",\"data\":\"data:application/octet-stream;base64,{encoded}\"}}]"
    );
    drop(encoded);
    assert!(required_todo_content(Some(&content)).is_ok());
    content.pop();
    content.push_str(
        ",{\"name\":\"extra.bin\",\"data\":\"data:application/octet-stream;base64,YQ==\"}]",
    );
    assert!(required_todo_content(Some(&content)).is_err());
    const {
        assert!(TODO_REQUEST_MAX_BYTES > TODO_CONTENT_MAX_BYTES + MAX_SHARE_BYTES);
        assert!(TODO_RESPONSE_MAX_BYTES > 2 * TODO_CONTENT_MAX_BYTES);
    }
}
