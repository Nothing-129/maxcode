use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;
use crate::commands::conversations::get_folder_conversation_core;
use crate::db::service::conversation_share_service;

use crate::models::{message::TurnRole, AgentType, ContentBlock, MessageTurn, SessionStats};

const SHARE_SNAPSHOT_VERSION: u8 = 2;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConversationShareOptions {
    pub include_tools: bool,
    pub include_thinking: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rounds: Option<Vec<usize>>,
}

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
    #[serde(default)]
    pub share_options: ConversationShareOptions,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_stats: Option<SessionStats>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationShareInfo {
    pub version: u8,
    pub token: String,
    pub shared_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ConversationShareRoundPreview {
    pub number: usize,
    pub preview: String,
}

#[derive(Debug, Serialize)]
pub struct ConversationSharePreview {
    pub version: u8,
    pub rounds: Vec<ConversationShareRoundPreview>,
    pub active_share: bool,
}

pub async fn get_conversation_share_preview_core(
    conn: &sea_orm::DatabaseConnection,
    conversation_id: i32,
) -> Result<ConversationSharePreview, AppCommandError> {
    let (detail, _) = get_folder_conversation_core(conn, conversation_id).await?;
    let mut rounds: Vec<ConversationShareRoundPreview> = Vec::new();
    for turn in detail.turns {
        if matches!(turn.role, TurnRole::System) {
            continue;
        }
        if matches!(turn.role, TurnRole::User) || rounds.is_empty() {
            let text = turn
                .blocks
                .iter()
                .filter_map(|block| match block {
                    ContentBlock::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join(" ");
            rounds.push(ConversationShareRoundPreview {
                number: rounds.len() + 1,
                preview: text.chars().take(512).collect(),
            });
        }
    }
    let active_share = conversation_share_service::has_active_share(conn, conversation_id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(ConversationSharePreview {
        version: SHARE_SNAPSHOT_VERSION,
        rounds,
        active_share,
    })
}

pub async fn create_conversation_share_core(
    conn: &sea_orm::DatabaseConnection,
    conversation_id: i32,
    options: ConversationShareOptions,
) -> Result<ConversationShareInfo, AppCommandError> {
    let (detail, _) = get_folder_conversation_core(conn, conversation_id).await?;
    let shared_at = Utc::now();
    let turns = select_share_turns(detail.turns, &options)?;
    // Deliberately construct a public DTO instead of serializing
    // DbConversationDetail: folder ids, external ids, branch names and local
    // origin paths have no place in a transcript-only share.
    let snapshot = SharedConversationSnapshot {
        version: SHARE_SNAPSHOT_VERSION,
        title: detail.summary.title,
        agent_type: detail.summary.agent_type,
        model: detail.summary.model,
        message_count: turns.len() as u32,
        created_at: detail.summary.created_at,
        updated_at: detail.summary.updated_at,
        shared_at,
        turns,
        share_options: options,
        session_stats: None,
    };
    let snapshot_json = serde_json::to_string(&snapshot).map_err(|err| {
        AppCommandError::task_execution_failed("Failed to serialize conversation share")
            .with_detail(err.to_string())
    })?;
    let row = conversation_share_service::publish(conn, conversation_id, snapshot_json)
        .await
        .map_err(AppCommandError::from)?;
    Ok(ConversationShareInfo {
        version: SHARE_SNAPSHOT_VERSION,
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
    let mut snapshot: SharedConversationSnapshot = serde_json::from_str(&row.snapshot_json)
        .map_err(|err| {
            AppCommandError::database_error("Shared conversation snapshot is invalid")
                .with_detail(err.to_string())
        })?;
    // Legacy links included all execution data. An absent opt-in defaults to
    // clean content at the public boundary, even before owners republish.
    if snapshot.version < SHARE_SNAPSHOT_VERSION {
        snapshot.share_options = ConversationShareOptions::default();
    }
    snapshot.turns = sanitize_share_turns(snapshot.turns, &snapshot.share_options);
    snapshot.message_count = snapshot.turns.len() as u32;
    snapshot.session_stats = None;
    snapshot.version = SHARE_SNAPSHOT_VERSION;
    Ok(snapshot)
}

fn select_share_turns(
    turns: Vec<MessageTurn>,
    options: &ConversationShareOptions,
) -> Result<Vec<MessageTurn>, AppCommandError> {
    let mut round = 0;
    let mut selected = Vec::new();
    for turn in turns {
        if matches!(turn.role, TurnRole::System) {
            continue;
        }
        if matches!(turn.role, TurnRole::User) || round == 0 {
            round += 1;
        }
        if options
            .rounds
            .as_ref()
            .is_none_or(|rounds| rounds.contains(&round))
        {
            selected.push(turn);
        }
    }
    if options.rounds.as_ref().is_some_and(|rounds| {
        rounds.is_empty() || rounds.iter().any(|&number| number == 0 || number > round)
    }) {
        return Err(AppCommandError::invalid_input(
            "Select valid conversation rounds",
        ));
    }
    let selected = sanitize_share_turns(selected, options);
    if selected.is_empty() {
        return Err(AppCommandError::invalid_input(
            "No shareable conversation content",
        ));
    }
    Ok(selected)
}

fn sanitize_share_turns(
    turns: Vec<MessageTurn>,
    options: &ConversationShareOptions,
) -> Vec<MessageTurn> {
    turns
        .into_iter()
        .filter_map(|mut turn| {
            if matches!(turn.role, TurnRole::System) {
                return None;
            }
            turn.blocks = turn
                .blocks
                .into_iter()
                .flat_map(|block| match block {
                    ContentBlock::ToolResult { images, .. } if !options.include_tools => images
                        .into_iter()
                        .map(|image| ContentBlock::Image {
                            data: image.data,
                            mime_type: image.mime_type,
                            uri: None,
                        })
                        .collect::<Vec<_>>(),
                    ContentBlock::ToolUse { .. } if !options.include_tools => vec![],
                    ContentBlock::Thinking { .. } if !options.include_thinking => vec![],
                    ContentBlock::Text { ref text } if text.trim().is_empty() => vec![],
                    ContentBlock::ImageGeneration { image: None, .. } => vec![],
                    ContentBlock::ImageGeneration {
                        image,
                        revised_prompt,
                    } => vec![ContentBlock::ImageGeneration {
                        image,
                        revised_prompt: if options.include_tools {
                            revised_prompt
                        } else {
                            None
                        },
                    }],
                    _ => vec![block],
                })
                .collect();
            if turn.blocks.is_empty() {
                return None;
            }
            for block in &mut turn.blocks {
                match block {
                    ContentBlock::Image { uri, .. } => *uri = None,
                    ContentBlock::ImageGeneration {
                        image: Some(image), ..
                    } => image.uri = None,
                    ContentBlock::ToolUse {
                        tool_use_id, meta, ..
                    } => {
                        *tool_use_id = None;
                        *meta = None;
                    }
                    ContentBlock::ToolResult {
                        tool_use_id,
                        agent_stats,
                        images,
                        ..
                    } => {
                        *tool_use_id = None;
                        *agent_stats = None;
                        for image in images {
                            image.uri = None;
                        }
                    }
                    _ => {}
                }
            }
            turn.id = String::new();
            turn.agent_message_id = None;
            turn.usage = None;
            turn.duration_ms = None;
            turn.completed_at = None;
            Some(turn)
        })
        .enumerate()
        .map(|(index, mut turn)| {
            turn.id = format!("shared-{index}");
            turn
        })
        .collect()
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/conversation-share-content.contract.rs"]
mod share_content_contract;
