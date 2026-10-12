use super::*;
use crate::acp::conversation_model_config::preferences_for_connect;
use crate::acp::types::{SessionConfigKindInfo, SessionConfigOptionInfo, SessionConfigSelectInfo};
use crate::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};

fn option(id: &str, category: &str, value: &str) -> SessionConfigOptionInfo {
    SessionConfigOptionInfo {
        id: id.into(),
        name: id.into(),
        category: Some(category.into()),
        description: None,
        recommended_value: None,
        kind: SessionConfigKindInfo::Select(SessionConfigSelectInfo {
            current_value: value.into(),
            options: vec![],
            groups: vec![],
        }),
    }
}

#[tokio::test]
async fn model_memory_worker_saves_history_without_relinking_or_changing_status() {
    let db = fresh_in_memory_db().await;
    let folder = seed_folder(&db, "/tmp/history-selectors").await;
    let id = seed_conversation(&db, folder, AgentType::Codex).await;
    let manager = ConnectionManager::new();
    manager
        .insert_test_connection("c", AgentType::Codex, None, EventEmitter::Noop)
        .await;
    let (state, _) = manager.get_state_and_emitter("c").await.unwrap();
    {
        let mut state = state.write().await;
        state.model_config_conversation_id = Some(id);
        state.selectors_ready = true;
        state.config_options = Some(vec![
            option("model", "model", "gpt-5.6"),
            option("reasoning_effort", "thought_level", "medium"),
        ]);
    }
    let event = AcpEvent::SelectorsReady;
    assert!(is_lifecycle_relevant(&event));
    let (tx, rx) = mpsc::channel(4);
    tx.send(Arc::new(EventEnvelope {
        seq: 1,
        connection_id: "c".into(),
        payload: event,
    }))
    .await
    .unwrap();
    drop(tx);
    connection_worker_loop("c".into(), db.conn.clone(), manager.clone_ref(), None, rx).await;
    let (_, values) = preferences_for_connect(
        &db.conn,
        AgentType::Codex,
        Some(id),
        None,
        Default::default(),
    )
    .await
    .unwrap();
    assert_eq!(values["model"], "gpt-5.6");
    assert_eq!(values["reasoning_effort"], "medium");
    assert_eq!(
        state.read().await.conversation_id,
        None,
        "observing selectors is not a prompt bind"
    );

    let mut retained_state = None;
    persist_model_config_event(&db.conn, &manager, &mut retained_state, "c")
        .await
        .unwrap();
    // A queued final confirmed change remains saveable after process cleanup.
    state.write().await.config_options = Some(vec![
        option("model", "model", "gpt-6.1-sol"),
        option("reasoning_effort", "thought_level", "high"),
    ]);
    manager.connections.lock().await.remove("c");
    persist_model_config_event(&db.conn, &manager, &mut retained_state, "c")
        .await
        .unwrap();
    let (_, values) = preferences_for_connect(
        &db.conn,
        AgentType::Codex,
        Some(id),
        None,
        Default::default(),
    )
    .await
    .unwrap();
    assert_eq!(values["model"], "gpt-6.1-sol");
    assert_eq!(values["reasoning_effort"], "high");
    assert!(is_lifecycle_relevant(&AcpEvent::SessionConfigOptions {
        config_options: vec![]
    }));
}
