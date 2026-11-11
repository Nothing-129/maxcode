//! Codex Fast is a conversation selection, while new chats use recent defaults.
use super::*;
use crate::acp::types::{SessionConfigBooleanInfo, SessionConfigSelectInfo};
use crate::db::service::conversation_service;
use crate::db::test_helpers::{fresh_disk_db, fresh_in_memory_db, seed_conversation, seed_folder};

fn select(id: &str, category: &str, value: &str) -> SessionConfigOptionInfo {
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

fn toggle(id: &str, enabled: bool) -> SessionConfigOptionInfo {
    SessionConfigOptionInfo {
        id: id.into(),
        name: id.into(),
        description: None,
        category: Some("model_config".into()),
        recommended_value: None,
        kind: SessionConfigKindInfo::Boolean(SessionConfigBooleanInfo {
            current_value: enabled,
        }),
    }
}

async fn save_ready(
    db: &DatabaseConnection,
    id: i32,
    agent: AgentType,
    options: Vec<SessionConfigOptionInfo>,
) {
    let mut state = SessionState::new("test".into(), agent, None, "web".into(), None);
    state.conversation_id = Some(id);
    state.selectors_ready = true;
    state.config_options = Some(options);
    persist_state(db, &Arc::new(RwLock::new(state)))
        .await
        .unwrap();
}

#[tokio::test]
async fn codex_histories_keep_their_own_fast_state_across_a_database_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let db = fresh_disk_db(dir.path()).await;
    let folder = seed_folder(&db, "/tmp/fast-memory").await;
    let old = seed_conversation(&db, folder, AgentType::Codex).await;
    let new = seed_conversation(&db, folder, AgentType::Codex).await;
    save_ready(
        &db.conn,
        old,
        AgentType::Codex,
        vec![
            select("model", "model", "gpt-6.1-sol"),
            select("fast-mode", "model_config", "off"),
        ],
    )
    .await;
    save_ready(
        &db.conn,
        new,
        AgentType::Codex,
        vec![
            select("model", "model", "gpt-6.1-terra"),
            select("fast-mode", "model_config", "on"),
        ],
    )
    .await;
    let old_summary = conversation_service::get_by_id(&db.conn, old)
        .await
        .unwrap();
    let summary = serde_json::to_value(old_summary).unwrap();
    assert_eq!(summary["model_config"]["fast-mode"], "off");

    db.conn.close().await.unwrap();
    let reopened = sea_orm::Database::connect(format!(
        "sqlite:{}?mode=rw",
        dir.path().join("source.db").display()
    ))
    .await
    .unwrap();
    for (id, model, expected, other) in [
        (old, "gpt-6.1-sol", "off", "on"),
        (new, "gpt-6.1-terra", "on", "off"),
    ] {
        let defaults = BTreeMap::from([
            ("model".into(), "other-model".into()),
            ("fast-mode".into(), other.into()),
            ("approval_policy".into(), "never".into()),
        ]);
        let (_, restored) =
            preferences_for_connect(&reopened, AgentType::Codex, Some(id), None, defaults)
                .await
                .unwrap();
        assert_eq!(restored["model"], model);
        assert_eq!(restored["fast-mode"], expected);
        assert_eq!(restored["approval_policy"], "never");
    }
}

#[tokio::test]
async fn legacy_codex_histories_do_not_inherit_fast_defaults_and_new_sessions_do() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/legacy-fast").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    conversation_service::bind_external_id(&db.conn, id, "legacy", &[])
        .await
        .unwrap();
    let defaults = BTreeMap::from([
        ("model".into(), "gpt-6.1-terra".into()),
        ("fast-mode".into(), "on".into()),
        ("fast_mode".into(), "true".into()),
        ("approval_policy".into(), "never".into()),
    ]);
    let (_, legacy) = preferences_for_connect(
        &db.conn,
        AgentType::Codex,
        None,
        Some("legacy"),
        defaults.clone(),
    )
    .await
    .unwrap();
    assert_eq!(
        legacy,
        BTreeMap::from([("approval_policy".into(), "never".into())])
    );
    let (_, new_session) =
        preferences_for_connect(&db.conn, AgentType::Codex, None, None, defaults.clone())
            .await
            .unwrap();
    assert_eq!(new_session, defaults);

    // An older snapshot can contain a model but no Fast value.
    save_ready(
        &db.conn,
        id,
        AgentType::Codex,
        vec![select("model", "model", "gpt-6.1-sol")],
    )
    .await;
    let (_, old_snapshot) =
        preferences_for_connect(&db.conn, AgentType::Codex, Some(id), None, defaults)
            .await
            .unwrap();
    assert_eq!(old_snapshot["model"], "gpt-6.1-sol");
    assert!(!old_snapshot.contains_key("fast-mode"));
    assert!(!old_snapshot.contains_key("fast_mode"));
}

#[tokio::test]
async fn codex_boolean_fast_is_saved_without_changing_other_agents() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/boolean-fast").await;
    let codex = seed_conversation(&db, folder, AgentType::Codex).await;
    let claude = seed_conversation(&db, folder, AgentType::ClaudeCode).await;
    for enabled in [true, false] {
        save_ready(
            &db.conn,
            codex,
            AgentType::Codex,
            vec![toggle("fast_mode", enabled)],
        )
        .await;
        let (_, values) = preferences_for_connect(
            &db.conn,
            AgentType::Codex,
            Some(codex),
            None,
            BTreeMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(values["fast_mode"], enabled.to_string());
    }
    save_ready(
        &db.conn,
        claude,
        AgentType::ClaudeCode,
        vec![
            select("model", "model", "claude"),
            toggle("fast-mode", false),
        ],
    )
    .await;
    let (_, values) = preferences_for_connect(
        &db.conn,
        AgentType::ClaudeCode,
        Some(claude),
        None,
        BTreeMap::from([("fast-mode".into(), "on".into())]),
    )
    .await
    .unwrap();
    assert_eq!(values["fast-mode"], "on");
    assert_eq!(values["model"], "claude");
}
