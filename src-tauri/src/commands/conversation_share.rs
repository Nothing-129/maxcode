use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;
use crate::commands::conversations::get_folder_conversation_core;
use crate::db::service::conversation_share_service;
#[cfg(feature = "tauri-runtime")]
use crate::db::AppDatabase;
use crate::models::{AgentType, MessageTurn, SessionStats};

const SHARE_SNAPSHOT_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedConversationSnapshot {
    pub version: u8,
    pub title: Option<String>,
    pub agent_type: AgentType,
    pub model: Option<String>,
    pub message_count: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub shared_at: DateTime<Utc>,
    pub turns: Vec<MessageTurn>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_stats: Option<SessionStats>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationShareInfo {
    pub token: String,
    pub shared_at: DateTime<Utc>,
}

pub async fn create_conversation_share_core(
    conn: &sea_orm::DatabaseConnection,
    conversation_id: i32,
) -> Result<ConversationShareInfo, AppCommandError> {
    let (detail, _) = get_folder_conversation_core(conn, conversation_id).await?;
    let shared_at = Utc::now();
    // Deliberately construct a public DTO instead of serializing
    // DbConversationDetail: folder ids, external ids, branch names and local
    // origin paths have no place in a transcript-only share.
    let snapshot = SharedConversationSnapshot {
        version: SHARE_SNAPSHOT_VERSION,
        title: detail.summary.title,
        agent_type: detail.summary.agent_type,
        model: detail.summary.model,
        message_count: detail.summary.message_count,
        created_at: detail.summary.created_at,
        updated_at: detail.summary.updated_at,
        shared_at,
        turns: detail.turns,
        session_stats: detail.session_stats,
    };
    let snapshot_json = serde_json::to_string(&snapshot).map_err(|err| {
        AppCommandError::task_execution_failed("Failed to serialize conversation share")
            .with_detail(err.to_string())
    })?;
    let row = conversation_share_service::publish(conn, conversation_id, snapshot_json)
        .await
        .map_err(AppCommandError::from)?;
    Ok(ConversationShareInfo {
        token: row.token,
        shared_at: row.updated_at,
    })
}

pub async fn revoke_conversation_share_core(
    conn: &sea_orm::DatabaseConnection,
    conversation_id: i32,
) -> Result<(), AppCommandError> {
    conversation_share_service::revoke(conn, conversation_id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(())
}

pub async fn get_shared_conversation_core(
    conn: &sea_orm::DatabaseConnection,
    token: &str,
) -> Result<SharedConversationSnapshot, AppCommandError> {
    if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppCommandError::not_found("Shared conversation not found"));
    }
    let row = conversation_share_service::find_active_by_token(conn, token)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found("Shared conversation not found"))?;
    serde_json::from_str(&row.snapshot_json).map_err(|err| {
        AppCommandError::database_error("Shared conversation snapshot is invalid")
            .with_detail(err.to_string())
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn create_conversation_share(
    db: tauri::State<'_, AppDatabase>,
    conversation_id: i32,
) -> Result<ConversationShareInfo, AppCommandError> {
    create_conversation_share_core(&db.conn, conversation_id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn revoke_conversation_share(
    db: tauri::State<'_, AppDatabase>,
    conversation_id: i32,
) -> Result<(), AppCommandError> {
    revoke_conversation_share_core(&db.conn, conversation_id).await
}
