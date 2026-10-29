//! Authenticated automation management, sharing the page's business operations.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::app_error::AppCommandError;
use crate::commands::automation::*;
use crate::db::AppDatabase;
use crate::models::AutomationDraft;
use crate::web::event_bridge::EventEmitter;

pub const TOOL_NAMES: &[&str] = &[
    "list_automations",
    "get_automation",
    "update_automation",
    "set_automation_enabled",
    "run_automation",
    "delete_automation",
    "list_automation_runs",
    "cancel_automation_run",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tool", content = "arguments", deny_unknown_fields)]
pub enum ToolRequest {
    #[serde(rename = "list_automations")]
    List {},
    #[serde(rename = "get_automation")]
    Get { automation_id: i32 },
    #[serde(rename = "update_automation")]
    Update {
        automation_id: i32,
        draft: Box<AutomationDraft>,
    },
    #[serde(rename = "set_automation_enabled")]
    SetEnabled { automation_id: i32, enabled: bool },
    #[serde(rename = "run_automation")]
    Run { automation_id: i32 },
    #[serde(rename = "delete_automation")]
    Delete { automation_id: i32 },
    #[serde(rename = "list_automation_runs")]
    Runs { automation_id: i32 },
    #[serde(rename = "cancel_automation_run")]
    Cancel { run_id: i32 },
}

pub async fn call(
    db: &AppDatabase,
    emitter: &EventEmitter,
    request: ToolRequest,
) -> Result<Value, AppCommandError> {
    Ok(match request {
        ToolRequest::List {} => json!(automation_list_core(db).await?),
        ToolRequest::Get { automation_id } => json!(automation_get_core(db, automation_id).await?),
        ToolRequest::Update {
            automation_id,
            draft,
        } => json!(automation_update_core(emitter, db, automation_id, *draft).await?),
        ToolRequest::SetEnabled {
            automation_id,
            enabled,
        } => json!(automation_set_enabled_core(emitter, db, automation_id, enabled).await?),
        ToolRequest::Run { automation_id } => {
            json!({"run_id": automation_run_now_core(automation_id).await?})
        }
        ToolRequest::Delete { automation_id } => {
            automation_delete_core(emitter, db, automation_id).await?;
            json!({"deleted": true})
        }
        ToolRequest::Runs { automation_id } => {
            json!(automation_runs_core(db, automation_id, 50).await?)
        }
        ToolRequest::Cancel { run_id } => {
            automation_cancel_run_core(run_id).await?;
            json!({"cancelled": true})
        }
    })
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/automation-management.contract.rs"]
mod maxcode_automation_management_contract;
