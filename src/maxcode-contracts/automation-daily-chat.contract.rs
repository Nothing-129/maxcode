use super::*;
use crate::db::{entities::conversation, service::automation_service, test_helpers};
use crate::models::{AgentType, AutomationDraft};
use sea_orm::ActiveModelTrait;

fn at(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

#[tokio::test]
async fn daily_chat_reuse_obeys_task_midnight_and_preserves_previous_history() {
    let db = test_helpers::fresh_in_memory_db().await;
    let data = tempfile::tempdir().unwrap();
    let draft: AutomationDraft = serde_json::from_value(serde_json::json!({
        "name": "Daily assistant", "enabled": true, "trigger_kind": "manual",
        "timezone": "Asia/Shanghai", "agent_type": "codex",
        "isolation": "shared_in_root", "is_remote_branch": false,
        "config": {"session_mode": "reuse_chat", "display_text": "Work",
            "prompt_blocks": [{"type": "text", "text": "Work"}]}
    }))
    .unwrap();
    let auto = automation_service::create(&db.conn, draft).await.unwrap();
    let chat = crate::commands::conversations::create_chat_conversation_core(
        &db.conn,
        data.path(),
        AgentType::Codex,
        None,
        None,
    )
    .await
    .unwrap();
    let row = conversation::Entity::find_by_id(chat.conversation_id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    let mut row: conversation::ActiveModel = row.into();
    row.created_at = Set(at("2026-10-15T16:00:00Z"));
    // Recent activity must not keep yesterday's chat alive after midnight.
    row.updated_at = Set(at("2026-10-16T16:00:00Z"));
    row.update(&db.conn).await.unwrap();
    bind_conversation(&db.conn, &auto, chat.conversation_id)
        .await
        .unwrap();

    for instant in ["2026-10-15T16:00:00Z", "2026-10-16T15:59:59Z"] {
        assert_eq!(
            reusable_conversation_at(&db.conn, &auto, at(instant))
                .await
                .unwrap()
                .unwrap()
                .id,
            chat.conversation_id
        );
    }
    assert!(
        reusable_conversation_at(&db.conn, &auto, at("2026-10-16T16:00:00Z"))
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        reusable_conversation_at(&db.conn, &auto, at("2026-10-20T16:00:00Z"))
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        conversation_service::get_by_id(&db.conn, chat.conversation_id)
            .await
            .is_ok()
    );

    // Different task timezones use their own calendar boundaries.
    let mut utc = auto.clone();
    utc.timezone = "UTC".into();
    assert!(
        reusable_conversation_at(&db.conn, &utc, at("2026-10-16T00:00:00Z"))
            .await
            .unwrap()
            .is_none()
    );
    let mut changed = auto.clone();
    changed.agent_type = "claude_code".into();
    assert!(
        reusable_conversation_at(&db.conn, &changed, at("2026-10-16T12:00:00Z"))
            .await
            .unwrap()
            .is_none()
    );

    let row = conversation::Entity::find_by_id(chat.conversation_id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    let mut row: conversation::ActiveModel = row.into();
    row.deleted_at = Set(Some(at("2026-10-16T12:00:00Z")));
    row.update(&db.conn).await.unwrap();
    assert!(
        reusable_conversation_at(&db.conn, &auto, at("2026-10-16T12:00:01Z"))
            .await
            .unwrap()
            .is_none()
    );
}
