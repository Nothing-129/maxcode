use super::*;
use crate::commands::question::{load_question_settings, KEY_QUESTION_ENABLED};

#[tokio::test]
async fn missing_preferences_enable_automations_and_disable_questions() {
    let db = crate::db::test_helpers::fresh_in_memory_db().await;
    let config = ChatAuthoringRuntimeConfig::new();
    apply_persisted_chat_authoring_config(&db.conn, &config).await;
    assert!(config.automations_enabled().await);
    assert!(!config.work_tasks_enabled().await);
    assert!(!load_question_settings(&db.conn).await.enabled);

    // Explicit choices still survive restart.
    app_metadata_service::upsert_value(&db.conn, KEY_CHAT_AUTHORING_AUTOMATIONS, "false")
        .await
        .unwrap();
    app_metadata_service::upsert_value(&db.conn, KEY_QUESTION_ENABLED, "true")
        .await
        .unwrap();
    apply_persisted_chat_authoring_config(&db.conn, &config).await;
    assert!(!config.automations_enabled().await);
    assert!(load_question_settings(&db.conn).await.enabled);
}
