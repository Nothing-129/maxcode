//! Conversation-owned model/thinking choices. Global selector preferences
//! seed new sessions; they must never replace an existing conversation's pair.
use std::collections::BTreeMap;
use std::sync::Arc;

use sea_orm::{sea_query::Expr, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use tokio::sync::RwLock;

use crate::db::{entities::conversation, error::DbError};
use crate::models::AgentType;

use super::session_state::SessionState;
use super::types::{SessionConfigKindInfo, SessionConfigOptionInfo};

pub async fn preferences_for_connect(
    db: &DatabaseConnection,
    agent_type: AgentType,
    conversation_id: Option<i32>,
    session_id: Option<&str>,
    mut defaults: BTreeMap<String, String>,
) -> Result<(Option<conversation::Model>, BTreeMap<String, String>), DbError> {
    if conversation_id.is_none() && session_id.is_none() {
        return Ok((None, defaults));
    }
    let agent = serde_json::to_value(agent_type).map_err(|e| DbError::Validation(e.to_string()))?;
    let mut query = conversation::Entity::find()
        .filter(conversation::Column::AgentType.eq(agent.as_str().unwrap_or_default()))
        .filter(conversation::Column::DeletedAt.is_null());
    query = if let Some(id) = conversation_id {
        query.filter(conversation::Column::Id.eq(id))
    } else {
        query.filter(conversation::Column::ExternalId.eq(session_id.unwrap_or_default()))
    };
    let row = query.one(db).await?;
    if conversation_id.is_some() && row.is_none() {
        return Err(DbError::NotFound("conversation for selected agent".into()));
    }
    let values = row
        .as_ref()
        .and_then(|row| row.model_config.as_deref())
        .map(serde_json::from_str::<BTreeMap<String, String>>)
        .transpose()
        .map_err(|e| DbError::Validation(format!("invalid conversation model config: {e}")))?
        .unwrap_or_default();
    defaults.retain(|id, _| !is_model_config_id(id) && !values.contains_key(id));
    defaults.extend(values);
    // No snapshot yet (including externally imported histories): keep the
    // native session's restored choices, rather than guessing from defaults
    // or `conversation.model`, which only records the initial model.
    Ok((row, defaults))
}

fn is_model_config_id(id: &str) -> bool {
    matches!(
        id,
        "model" | "reasoning_effort" | "thought_level" | "thinking_level" | "effort" | "thinking"
    )
}

fn model_config_values(options: &[SessionConfigOptionInfo]) -> BTreeMap<String, String> {
    options
        .iter()
        .filter(|option| {
            matches!(option.category.as_deref(), Some("model" | "thought_level"))
                || is_model_config_id(&option.id)
        })
        .filter_map(|option| match &option.kind {
            SessionConfigKindInfo::Select(select) => {
                Some((option.id.clone(), select.current_value.clone()))
            }
            SessionConfigKindInfo::Boolean(_) => None,
        })
        .collect()
}

async fn save_model_config(
    db: &DatabaseConnection,
    conversation_id: i32,
    options: &[SessionConfigOptionInfo],
) -> Result<(), DbError> {
    let values = model_config_values(options);
    if values.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(&values).map_err(|e| DbError::Validation(e.to_string()))?;
    conversation::Entity::update_many()
        .col_expr(conversation::Column::ModelConfig, Expr::value(json.clone()))
        .filter(conversation::Column::Id.eq(conversation_id))
        .filter(conversation::Column::DeletedAt.is_null())
        .filter(
            conversation::Column::ModelConfig
                .is_null()
                .or(conversation::Column::ModelConfig.ne(json)),
        )
        .exec(db)
        .await?;
    // Selector persistence is not conversation activity: don't bump updated_at.
    Ok(())
}

pub async fn persist_state(
    db: &DatabaseConnection,
    state: &Arc<RwLock<SessionState>>,
) -> Result<(), DbError> {
    let (conversation_id, options) = {
        let state = state.read().await;
        if !state.selectors_ready {
            return Ok(());
        }
        (
            state.conversation_id.or(state.model_config_conversation_id),
            state.config_options.clone(),
        )
    };
    if let (Some(id), Some(options)) = (conversation_id, options) {
        save_model_config(db, id, &options).await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/conversation-model-memory.contract.rs"]
mod contracts;
