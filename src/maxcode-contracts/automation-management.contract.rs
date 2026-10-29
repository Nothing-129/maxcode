use super::*;
use crate::acp::chat_authoring::{
    AuthoringContext, ChatAuthoringAccess, ChatAuthoringConfig, ChatAuthoringRuntimeConfig,
};
use crate::commands::chat_authoring::DbChatAuthoring;
use crate::db::test_helpers::fresh_in_memory_db;
use crate::models::{AutomationConfig, IsolationMode, TriggerKind};
use std::sync::Arc;

fn draft() -> AutomationDraft {
    AutomationDraft {
        name: "Daily todo review".into(),
        enabled: true,
        trigger_kind: TriggerKind::Manual,
        cron: None,
        timezone: "Asia/Shanghai".into(),
        agent_type: "codex".into(),
        root_folder_id: None,
        isolation: IsolationMode::SharedInRoot,
        branch: None,
        is_remote_branch: false,
        config: json!({"display_text":"Review the attached todo", "prompt_blocks":[{"type":"text","text":"Review the attached todo"}], "todo_origins":[{"scope_id":"personal","todo_id":"123456781234123412341234567890ab"}]}),
    }
}

#[tokio::test]
async fn automation_management_round_trips_todos_and_honors_live_switch() {
    let db = Arc::new(fresh_in_memory_db().await);
    let config = ChatAuthoringRuntimeConfig::new();
    let access = DbChatAuthoring::new(db.clone(), EventEmitter::Noop, config.clone());
    let ctx = || AuthoringContext {
        conversation_id: None,
        working_dir: "/".into(),
    };
    assert!(access
        .automation_call(ctx(), ToolRequest::List {})
        .await
        .is_err());
    config
        .set(ChatAuthoringConfig {
            automations_enabled: true,
            work_tasks_enabled: false,
        })
        .await;
    let auto = automation_create_core(&EventEmitter::Noop, &db, draft())
        .await
        .unwrap();
    let listed = access
        .automation_call(ctx(), ToolRequest::List {})
        .await
        .unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    let fetched = access
        .automation_call(
            ctx(),
            ToolRequest::Get {
                automation_id: auto.id,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        fetched["config"]["todo_origins"],
        draft().config["todo_origins"]
    );
    let mut edited = draft();
    edited.name = "Renamed".into();
    let updated = access
        .automation_call(
            ctx(),
            ToolRequest::Update {
                automation_id: auto.id,
                draft: Box::new(edited),
            },
        )
        .await
        .unwrap();
    assert_eq!(updated["name"], "Renamed");
    assert_eq!(
        updated["config"]["todo_origins"],
        fetched["config"]["todo_origins"]
    );
    let paused = access
        .automation_call(
            ctx(),
            ToolRequest::SetEnabled {
                automation_id: auto.id,
                enabled: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(paused["enabled"], false);
    assert_eq!(
        access
            .automation_call(
                ctx(),
                ToolRequest::Runs {
                    automation_id: auto.id
                }
            )
            .await
            .unwrap(),
        json!([])
    );
    config.set(ChatAuthoringConfig::default()).await;
    assert!(access
        .automation_call(
            ctx(),
            ToolRequest::Delete {
                automation_id: auto.id
            }
        )
        .await
        .is_err());
    assert!(automation_get_core(&db, auto.id).await.is_ok());
    config
        .set(ChatAuthoringConfig {
            automations_enabled: true,
            work_tasks_enabled: false,
        })
        .await;
    access
        .automation_call(
            ctx(),
            ToolRequest::Delete {
                automation_id: auto.id,
            },
        )
        .await
        .unwrap();
    assert!(automation_list_core(&db).await.unwrap().is_empty());
}

#[tokio::test]
async fn automation_todo_origins_validate_at_save_and_old_configs_remain_readable() {
    let db = fresh_in_memory_db().await;
    let mut invalid = draft();
    invalid.config["todo_origins"][0]["todo_id"] = json!("invalid");
    assert!(automation_create_core(&EventEmitter::Noop, &db, invalid)
        .await
        .is_err());
    let mut invalid = draft();
    invalid.config["action"] = json!("enqueue_task");
    assert!(automation_create_core(&EventEmitter::Noop, &db, invalid)
        .await
        .is_err());
    let mut legacy = draft();
    legacy
        .config
        .as_object_mut()
        .unwrap()
        .remove("todo_origins");
    let saved = automation_create_core(&EventEmitter::Noop, &db, legacy)
        .await
        .unwrap();
    assert!(serde_json::from_value::<AutomationConfig>(saved.config)
        .unwrap()
        .todo_origins
        .is_empty());
}
