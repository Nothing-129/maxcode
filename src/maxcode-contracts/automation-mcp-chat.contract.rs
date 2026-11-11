use super::*;
use crate::db::service::automation_service;
use crate::db::test_helpers::fresh_in_memory_db;
use serde_json::json;

async fn harness(enabled: bool) -> (Arc<AppDatabase>, DbChatAuthoring) {
    let db = Arc::new(fresh_in_memory_db().await);
    let config = ChatAuthoringRuntimeConfig::new();
    config
        .set(ChatAuthoringConfig {
            automations_enabled: enabled,
            work_tasks_enabled: false,
        })
        .await;
    let access = DbChatAuthoring::new(db.clone(), EventEmitter::Noop, config);
    (db, access)
}
fn spec(extra: serde_json::Value) -> NewAutomationSpec {
    let mut value = json!({"name":"Invoice check", "prompt":"Check invoices", "cron":"0 9 * * *", "timezone":"Asia/Shanghai", "agent_type":"codex", "enabled":true, "target":"chat"});
    value
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::from_value(value).unwrap()
}
fn ctx() -> AuthoringContext {
    AuthoringContext {
        conversation_id: None,
        working_dir: "/unregistered-chat".into(),
    }
}
#[tokio::test]
async fn scheduled_chat_creates_without_a_project() {
    let (db, access) = harness(true).await;
    let out = access.create_automation(ctx(), spec(json!({}))).await;
    assert!(out.created, "{:?}", out.note);
    assert!(out.folder_path.is_none());
    assert!(out.folder_name.is_none());
    assert!(out.next_run_at.is_some());
    let row = automation_service::get(&db.conn, out.id.unwrap())
        .await
        .unwrap();
    assert_eq!(row.root_folder_id, None);
    assert_eq!(row.isolation, IsolationMode::SharedInRoot);
    assert_eq!(row.agent_type, "codex");
    assert_eq!(row.cron.as_deref(), Some("0 9 * * *"));
    assert_eq!(row.timezone, "Asia/Shanghai");
    assert!(row.branch.is_none());
    assert!(!row.is_remote_branch);
    assert_eq!(row.config["prompt_blocks"][0]["text"], "Check invoices");
    assert_eq!(row.config["session_mode"], "new_per_run");
}
#[tokio::test]
async fn chat_rejects_project_path_and_enqueue_without_writing() {
    let (db, access) = harness(true).await;
    folder_service::add_folder(&db.conn, "/repo/app")
        .await
        .unwrap();
    for extra in [
        json!({"folder_path":"/repo/app"}),
        json!({"action":"enqueue_task"}),
    ] {
        let out = access.create_automation(ctx(), spec(extra)).await;
        assert!(!out.created);
        assert!(out.note.is_some());
    }
    assert!(automation_service::list(&db.conn).await.unwrap().is_empty());
}
#[tokio::test]
async fn chat_honors_disabled_switch_and_requires_an_agent() {
    let (db, access) = harness(false).await;
    assert!(
        !access
            .create_automation(ctx(), spec(json!({})))
            .await
            .created
    );
    assert!(automation_service::list(&db.conn).await.unwrap().is_empty());
    let (db, access) = harness(true).await;
    assert!(
        !access
            .create_automation(ctx(), spec(json!({"agent_type":null})))
            .await
            .created
    );
    assert!(automation_service::list(&db.conn).await.unwrap().is_empty());
}

#[tokio::test]
async fn chat_inherits_callers_agent_even_inside_a_project() {
    let (db, access) = harness(true).await;
    let folder = folder_service::add_folder(&db.conn, "/repo/app")
        .await
        .unwrap();
    let caller =
        conversation_service::create_chat(&db.conn, folder.id, AgentType::Codex, None, None)
            .await
            .unwrap();
    let ctx = AuthoringContext {
        conversation_id: Some(caller.id),
        working_dir: "/repo/app".into(),
    };
    let out = access
        .create_automation(ctx, spec(json!({"agent_type":null})))
        .await;
    assert!(out.created, "{:?}", out.note);
    let row = automation_service::get(&db.conn, out.id.unwrap())
        .await
        .unwrap();
    assert_eq!(row.root_folder_id, None);
    assert_eq!(row.agent_type, "codex");
}
