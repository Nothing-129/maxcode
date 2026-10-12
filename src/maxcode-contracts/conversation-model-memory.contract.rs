//! Reopening one conversation must retain its own model/thinking pair even
//! when another conversation changed the defaults for the same agent.
use super::*;
use crate::acp::types::SessionConfigSelectInfo;
use crate::db::service::conversation_service;
use crate::db::test_helpers::{fresh_disk_db, fresh_in_memory_db, seed_conversation, seed_folder};

fn option(id: &str, category: &str, value: &str) -> SessionConfigOptionInfo {
    SessionConfigOptionInfo {
        id: id.into(),
        name: id.into(),
        description: None,
        category: Some(category.into()),
        recommended_value: None,
        kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
            current_value: value.into(),
            options: vec![],
            groups: vec![],
        }),
    }
}

fn pair(model: &str, effort: &str) -> Vec<SessionConfigOptionInfo> {
    vec![
        option("model", "model", model),
        option("reasoning_effort", "thought_level", effort),
    ]
}

fn defaults() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("model".into(), "gpt-6.1-sol".into()),
        ("reasoning_effort".into(), "high".into()),
    ])
}

#[tokio::test]
async fn history_keeps_its_own_pair_across_database_reopen_and_other_conversations() {
    let dir = tempfile::tempdir().unwrap();
    let db = fresh_disk_db(dir.path()).await;
    let folder = seed_folder(&db, "/tmp/model-memory").await;
    let first = seed_conversation(&db, folder, AgentType::Codex).await;
    let second = seed_conversation(&db, folder, AgentType::Codex).await;
    let before = conversation_service::get_by_id(&db.conn, first)
        .await
        .unwrap()
        .updated_at;
    save_model_config(&db.conn, first, &pair("gpt-5.6", "medium"))
        .await
        .unwrap();
    save_model_config(&db.conn, second, &pair("gpt-6.1-sol", "high"))
        .await
        .unwrap();
    // Reading preferences alone must work with no agent process or browser storage.
    db.conn.close().await.unwrap();
    let reopened = sea_orm::Database::connect(format!(
        "sqlite:{}?mode=rw",
        dir.path().join("source.db").display()
    ))
    .await
    .unwrap();
    let (_, restored) =
        preferences_for_connect(&reopened, AgentType::Codex, Some(first), None, defaults())
            .await
            .unwrap();
    assert_eq!(restored["model"], "gpt-5.6");
    assert_eq!(restored["reasoning_effort"], "medium");
    assert_eq!(
        conversation_service::get_by_id(&reopened, first)
            .await
            .unwrap()
            .updated_at,
        before
    );
    let (_, restored) = preferences_for_connect(
        &reopened,
        AgentType::Codex,
        Some(second),
        None,
        BTreeMap::new(),
    )
    .await
    .unwrap();
    assert_eq!(restored, defaults());
}

#[tokio::test]
async fn legacy_history_preserves_native_state_and_new_sessions_use_defaults() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/legacy-memory").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    conversation_service::bind_external_id(&db.conn, id, "old-session", &[])
        .await
        .unwrap();
    let (row, restored) = preferences_for_connect(
        &db.conn,
        AgentType::Codex,
        None,
        Some("old-session"),
        defaults(),
    )
    .await
    .unwrap();
    assert_eq!(row.unwrap().id, id);
    assert!(
        restored.is_empty(),
        "legacy native model/effort must not be overwritten by defaults"
    );
    let (_, new_session) =
        preferences_for_connect(&db.conn, AgentType::Codex, None, None, defaults())
            .await
            .unwrap();
    assert_eq!(new_session, defaults());
    assert!(
        preferences_for_connect(&db.conn, AgentType::ClaudeCode, Some(id), None, defaults())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn persist_only_confirmed_ready_values_and_keep_permissions_out_of_model_memory() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/confirmed-memory").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    let mut state = SessionState::new("c".into(), AgentType::Codex, None, "web".into(), None);
    state.conversation_id = Some(id);
    state.config_options = Some(pair("gpt-5.6", "medium"));
    let state = Arc::new(RwLock::new(state));
    persist_state(&db.conn, &state).await.unwrap();
    let (_, unready) =
        preferences_for_connect(&db.conn, AgentType::Codex, Some(id), None, defaults())
            .await
            .unwrap();
    assert!(unready.is_empty());
    {
        let mut state = state.write().await;
        state.selectors_ready = true;
        state
            .config_options
            .as_mut()
            .unwrap()
            .push(option("approval_policy", "other", "never"));
    }
    persist_state(&db.conn, &state).await.unwrap();
    let (_, confirmed) =
        preferences_for_connect(&db.conn, AgentType::Codex, Some(id), None, defaults())
            .await
            .unwrap();
    assert_eq!(confirmed["model"], "gpt-5.6");
    assert_eq!(confirmed["reasoning_effort"], "medium");
    assert_eq!(confirmed.len(), 2);
    // A model switch may remove thinking support; do not replay its old effort.
    state.write().await.config_options = Some(vec![option("model", "model", "plain-model")]);
    persist_state(&db.conn, &state).await.unwrap();
    let (_, switched) =
        preferences_for_connect(&db.conn, AgentType::Codex, Some(id), None, defaults())
            .await
            .unwrap();
    assert_eq!(
        switched,
        BTreeMap::from([("model".into(), "plain-model".into())])
    );
}

#[tokio::test]
async fn preserving_an_outgoing_session_also_preserves_its_model_pair() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/preserved-memory").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    conversation_service::bind_external_id(&db.conn, id, "old", &[])
        .await
        .unwrap();
    save_model_config(&db.conn, id, &pair("gpt-5.6", "medium"))
        .await
        .unwrap();
    let preserved = conversation_service::bind_external_id(&db.conn, id, "new", &[])
        .await
        .unwrap()
        .unwrap();
    let (_, old) = preferences_for_connect(
        &db.conn,
        AgentType::Codex,
        Some(preserved),
        None,
        defaults(),
    )
    .await
    .unwrap();
    assert_eq!(old["model"], "gpt-5.6");
    assert_eq!(old["reasoning_effort"], "medium");
}
