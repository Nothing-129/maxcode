use super::*;
use crate::db::{service::automation_runtime_service as runtime, test_helpers};
use crate::models::automation::{AutomationMessageScope, AutomationMessageTrigger};

fn message_draft() -> crate::models::AutomationDraft {
    crate::models::AutomationDraft {
        name: "Message assistant".into(),
        enabled: true,
        trigger_kind: crate::models::TriggerKind::Message,
        cron: None,
        timezone: "Asia/Shanghai".into(),
        agent_type: "codex".into(),
        root_folder_id: None,
        isolation: IsolationMode::SharedInRoot,
        branch: None,
        is_remote_branch: false,
        config: serde_json::json!({"session_mode":"reuse_chat", "display_text":"Handle incoming work",
            "prompt_blocks":[{"type":"text", "text":"Handle incoming work"}],
            "message_trigger":{"scope":"at-me", "batch_minutes":10}}),
    }
}
fn test_engine(db: AppDatabase, dir: &Path) -> AutomationEngine {
    AutomationEngine {
        db,
        manager: ConnectionManager::new(),
        emitter: EventEmitter::Noop,
        bus: Arc::new(InternalEventBus::new(Arc::new(
            crate::acp::EventBusMetrics::default(),
        ))),
        data_dir: dir.into(),
        index: Arc::new(Mutex::new(HashMap::new())),
        automation_locks: Arc::new(Mutex::new(HashMap::new())),
        root_locks: Arc::new(Mutex::new(HashMap::new())),
        _engine_lock: tempfile::tempfile().unwrap(),
        listeners: MessageListeners::default(),
    }
}
#[tokio::test]
async fn empty_inbox_and_batch_wait_do_not_create_run_or_conversation() {
    let db = test_helpers::fresh_in_memory_db().await;
    let auto = automation_service::create(&db.conn, message_draft())
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let engine = test_engine(db, dir.path());
    assert!(engine
        .run_automation(auto.id, "message", None)
        .await
        .unwrap_err()
        .contains("no new messages"));
    let cfg: AutomationConfig = serde_json::from_value(auto.config.clone()).unwrap();
    let key = super::super::messages::source_key(cfg.message_trigger.as_ref().unwrap());
    runtime::enqueue(&engine.db.conn, auto.id, &key, "m1", "{}")
        .await
        .unwrap();
    assert!(engine
        .run_automation(auto.id, "message", None)
        .await
        .unwrap_err()
        .contains("waiting for message batch"));
    assert!(automation_service::list_runs(&engine.db.conn, auto.id, 100)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        runtime::pending(&engine.db.conn, auto.id, &key)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(!dir.path().join("chat-sessions").exists());
}
#[tokio::test]
async fn durable_binding_restores_native_session_and_changes_agent_without_mixing_history() {
    let data = tempfile::tempdir().unwrap();
    let db = test_helpers::fresh_disk_db(data.path()).await;
    let auto = automation_service::create(&db.conn, message_draft())
        .await
        .unwrap();
    let chat = crate::commands::conversations::create_chat_conversation_core(
        &db.conn,
        data.path(),
        AgentType::Codex,
        Some("Assistant".into()),
        None,
    )
    .await
    .unwrap();
    conversation_service::bind_external_id(&db.conn, chat.conversation_id, "native-session", &[])
        .await
        .unwrap();
    runtime::bind_conversation(&db.conn, &auto, chat.conversation_id)
        .await
        .unwrap();
    let path = data.path().join("source.db");
    drop(db);
    let conn = sea_orm::Database::connect(format!("sqlite:{}", path.display()))
        .await
        .unwrap();
    let restored = runtime::reusable_conversation(&conn, &auto)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(restored.id, chat.conversation_id);
    assert_eq!(restored.external_id.as_deref(), Some("native-session"));
    let mut changed = auto.clone();
    changed.agent_type = "claude_code".into();
    assert!(runtime::reusable_conversation(&conn, &changed)
        .await
        .unwrap()
        .is_none());
}
#[tokio::test]
async fn inbox_deduplicates_and_claims_once_including_after_failure() {
    let db = test_helpers::fresh_in_memory_db().await;
    let auto = automation_service::create(&db.conn, message_draft())
        .await
        .unwrap();
    for _ in 0..2 {
        runtime::enqueue(&db.conn, auto.id, "scope", "message1", "{}")
            .await
            .unwrap();
    }
    runtime::enqueue(&db.conn, auto.id, "scope", "message2", "{}")
        .await
        .unwrap();
    let rows = runtime::pending(&db.conn, auto.id, "scope").await.unwrap();
    assert_eq!(rows.len(), 2);
    let run = automation_service::start_run(&db.conn, auto.id, "message", None)
        .await
        .unwrap();
    runtime::claim(&db.conn, &rows, run.id).await.unwrap();
    automation_service::settle_run(
        &db.conn,
        run.id,
        AutomationRunStatus::Failed,
        None,
        Some("worker lost".into()),
        None,
    )
    .await
    .unwrap();
    runtime::enqueue(&db.conn, auto.id, "scope", "message1", "{}")
        .await
        .unwrap();
    assert!(runtime::pending(&db.conn, auto.id, "scope")
        .await
        .unwrap()
        .is_empty());
    assert!(runtime::claim(&db.conn, &rows, run.id).await.is_err());
}
#[tokio::test]
async fn validation_rejects_project_reuse_missing_targets_and_cross_account_listener() {
    let db = test_helpers::fresh_in_memory_db().await;
    let mut draft = message_draft();
    draft.root_folder_id = Some(1);
    assert!(automation_service::create(&db.conn, draft).await.is_err());
    let mut draft = message_draft();
    draft.config["message_trigger"]["scope"] = "group".into();
    assert!(automation_service::create(&db.conn, draft).await.is_err());
    let mut draft = message_draft();
    draft.config["message_trigger"]["profile"] = "account1,account2".into();
    assert!(automation_service::create(&db.conn, draft).await.is_err());
    let auto = automation_service::create(&db.conn, message_draft())
        .await
        .unwrap();
    assert!(auto.next_run_at.is_none());
}
#[tokio::test]
async fn changing_scope_cannot_hide_pending_messages() {
    let db = test_helpers::fresh_in_memory_db().await;
    let auto = automation_service::create(&db.conn, message_draft())
        .await
        .unwrap();
    let cfg: AutomationConfig = serde_json::from_value(auto.config.clone()).unwrap();
    let key = super::super::messages::source_key(cfg.message_trigger.as_ref().unwrap());
    runtime::enqueue(&db.conn, auto.id, &key, "m1", "{}")
        .await
        .unwrap();
    let mut draft = message_draft();
    draft.config["message_trigger"]["scope"] = "all-direct".into();
    assert!(automation_service::update(&db.conn, auto.id, draft)
        .await
        .unwrap_err()
        .to_string()
        .contains("process pending"));
    assert_eq!(
        runtime::pending(&db.conn, auto.id, &key)
            .await
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn cli_scope_is_passed_as_arguments_and_message_ids_are_deduplicated_per_chat() {
    use super::super::messages::{listener_args, message_key, source_key};
    let source = AutomationMessageTrigger {
        scope: AutomationMessageScope::Group,
        target: "Group; $(touch nope)".into(),
        profile: "corp:user".into(),
        keywords: "todo".into(),
        batch_minutes: 10,
    };
    let args = listener_args(&source);
    assert!(args
        .windows(2)
        .any(|a| a == ["--chat-query", "Group; $(touch nope)"]));
    assert!(args.windows(2).any(|a| a == ["--format", "ndjson"]));
    assert!(!args.contains(&"--yes".to_string()));
    let mut batched = source.clone();
    batched.batch_minutes = 0;
    assert_eq!(source_key(&source), source_key(&batched));
    assert_ne!(
        message_key(&serde_json::json!({"message_id":"m1", "conversation_id":"c1"})),
        message_key(&serde_json::json!({"message_id":"m1", "conversation_id":"c2"}))
    );
    assert!(message_key(&serde_json::json!({"content":"no stable id"})).is_none());
}

#[tokio::test]
async fn a_busy_interactive_chat_keeps_messages_pending_without_creating_a_run() {
    let db = test_helpers::fresh_in_memory_db().await;
    let mut draft = message_draft();
    draft.config["message_trigger"]["batch_minutes"] = 0.into();
    let auto = automation_service::create(&db.conn, draft).await.unwrap();
    let data = tempfile::tempdir().unwrap();
    let chat = crate::commands::conversations::create_chat_conversation_core(
        &db.conn,
        data.path(),
        AgentType::Codex,
        None,
        None,
    )
    .await
    .unwrap();
    runtime::bind_conversation(&db.conn, &auto, chat.conversation_id)
        .await
        .unwrap();
    let cfg: AutomationConfig = serde_json::from_value(auto.config.clone()).unwrap();
    let key = super::super::messages::source_key(cfg.message_trigger.as_ref().unwrap());
    runtime::enqueue(&db.conn, auto.id, &key, "m1", "{}")
        .await
        .unwrap();
    let engine = test_engine(db, data.path());
    let _rx = engine
        .manager
        .insert_test_connection_live("interactive", AgentType::Codex, None, EventEmitter::Noop)
        .await;
    let state = engine.manager.get_state("interactive").await.unwrap();
    {
        let mut state = state.write().await;
        state.conversation_id = Some(chat.conversation_id);
        state.turn_in_flight = true;
    }
    assert!(engine
        .run_automation(auto.id, "message", None)
        .await
        .unwrap_err()
        .contains("busy"));
    assert!(state.read().await.turn_in_flight);
    assert!(automation_service::list_runs(&engine.db.conn, auto.id, 100)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        runtime::pending(&engine.db.conn, auto.id, &key)
            .await
            .unwrap()
            .len(),
        1
    );
}
#[tokio::test]
async fn another_user_turn_cannot_settle_an_unadmitted_automation_prompt() {
    let db = test_helpers::fresh_in_memory_db().await;
    let auto = automation_service::create(&db.conn, message_draft())
        .await
        .unwrap();
    let run = automation_service::start_run(&db.conn, auto.id, "message", None)
        .await
        .unwrap();
    let data = tempfile::tempdir().unwrap();
    let engine = test_engine(db, data.path());
    engine.index.lock().await.insert(
        "connection".into(),
        RunBinding {
            run_id: run.id,
            automation_id: auto.id,
            prompt_id: "automation-prompt".into(),
            admitted: false,
            sent: false,
            disconnect_on_finish: false,
        },
    );
    let event = |payload| EventEnvelope {
        seq: 1,
        connection_id: "connection".into(),
        payload,
    };
    let complete = || {
        event(AcpEvent::TurnComplete {
            session_id: "native".into(),
            stop_reason: "end_turn".into(),
            agent_type: "codex".into(),
        })
    };
    engine
        .on_event(&event(AcpEvent::UserMessage {
            message_id: "interactive-prompt".into(),
            blocks: vec![],
        }))
        .await;
    engine.on_event(&complete()).await;
    assert!(automation_service::has_active_run(&engine.db.conn, auto.id)
        .await
        .unwrap());
    engine
        .on_event(&event(AcpEvent::UserMessage {
            message_id: "automation-prompt".into(),
            blocks: vec![],
        }))
        .await;
    engine.on_event(&complete()).await;
    assert!(
        !automation_service::has_active_run(&engine.db.conn, auto.id)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn stale_event_ticks_do_not_run_an_automation_that_changed_to_manual() {
    let db = test_helpers::fresh_in_memory_db().await;
    let mut draft = message_draft();
    draft.trigger_kind = crate::models::TriggerKind::Manual;
    let auto = automation_service::create(&db.conn, draft).await.unwrap();
    let data = tempfile::tempdir().unwrap();
    let engine = test_engine(db, data.path());
    assert!(engine
        .run_automation(auto.id, "message", None)
        .await
        .unwrap_err()
        .contains("no longer enabled"));
    assert!(automation_service::list_runs(&engine.db.conn, auto.id, 100)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn reconcile_recovers_an_accepted_turn_when_both_prompt_and_completion_events_were_lost() {
    let db = test_helpers::fresh_in_memory_db().await;
    let auto = automation_service::create(&db.conn, message_draft())
        .await
        .unwrap();
    let data = tempfile::tempdir().unwrap();
    let chat = crate::commands::conversations::create_chat_conversation_core(
        &db.conn,
        data.path(),
        AgentType::Codex,
        None,
        None,
    )
    .await
    .unwrap();
    let run = automation_service::start_run(&db.conn, auto.id, "message", None)
        .await
        .unwrap();
    automation_service::attach_run_runtime(
        &db.conn,
        run.id,
        Some(chat.conversation_id),
        Some("connection".into()),
        None,
    )
    .await
    .unwrap();
    use sea_orm::{ColumnTrait, QueryFilter};
    conversation::Entity::update_many()
        .col_expr(
            conversation::Column::Status,
            sea_orm::sea_query::Expr::value("completed"),
        )
        .filter(conversation::Column::Id.eq(chat.conversation_id))
        .exec(&db.conn)
        .await
        .unwrap();
    let engine = test_engine(db, data.path());
    let _rx = engine
        .manager
        .insert_test_connection_live("connection", AgentType::Codex, None, EventEmitter::Noop)
        .await;
    engine.index.lock().await.insert(
        "connection".into(),
        RunBinding {
            run_id: run.id,
            automation_id: auto.id,
            prompt_id: "automation-prompt".into(),
            admitted: false,
            sent: true,
            disconnect_on_finish: false,
        },
    );
    engine.reconcile_once().await;
    assert!(
        !automation_service::has_active_run(&engine.db.conn, auto.id)
            .await
            .unwrap()
    );
    assert!(engine.manager.get_state("connection").await.is_some());
}
