//! Durable session binding and deduplicated inbox. A claimed message is never
//! replayed automatically after an interrupted or failed execution.
use crate::db::entities::automation_message::{self, Model};
use crate::db::error::DbError;
use crate::db::service::{app_metadata_service, conversation_service};
use crate::models::{AutomationInfo, DbConversationSummary};
use chrono::{DateTime, Utc};
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct SessionBinding {
    target_key: String,
    conversation_id: i32,
}
fn binding_key(id: i32) -> String {
    format!("automation.session.{id}")
}
fn session_target(auto: &AutomationInfo) -> String {
    // Reuse is chat-only. Changing the agent starts a separate native session;
    // prompt, schedule and model edits do not lose the current chat's history.
    auto.agent_type.clone()
}
pub async fn reusable_conversation(
    conn: &DatabaseConnection,
    auto: &AutomationInfo,
) -> Result<Option<DbConversationSummary>, DbError> {
    let Some(value) = app_metadata_service::get_value(conn, &binding_key(auto.id)).await? else {
        return Ok(None);
    };
    let binding: SessionBinding = serde_json::from_str(&value)
        .map_err(|e| DbError::Validation(format!("invalid automation session binding: {e}")))?;
    if binding.target_key != session_target(auto) {
        return Ok(None);
    }
    // Deleted conversations start a fresh chat. Database errors must propagate.
    use crate::db::entities::conversation;
    if conversation::Entity::find_by_id(binding.conversation_id)
        .filter(conversation::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .is_none()
    {
        return Ok(None);
    }
    conversation_service::get_by_id(conn, binding.conversation_id)
        .await
        .map(Some)
}
pub async fn bind_conversation(
    conn: &DatabaseConnection,
    auto: &AutomationInfo,
    id: i32,
) -> Result<(), DbError> {
    let value = serde_json::to_string(&SessionBinding {
        target_key: session_target(auto),
        conversation_id: id,
    })
    .map_err(|e| DbError::Validation(e.to_string()))?;
    app_metadata_service::upsert_value(conn, &binding_key(auto.id), &value).await
}
pub async fn enqueue(
    conn: &DatabaseConnection,
    id: i32,
    source: &str,
    key: &str,
    payload: &str,
) -> Result<(), DbError> {
    automation_message::Entity::insert(automation_message::ActiveModel {
        id: NotSet,
        automation_id: Set(id),
        source_key: Set(source.into()),
        message_key: Set(key.into()),
        payload: Set(payload.into()),
        received_at: Set(Utc::now()),
        run_id: Set(None),
    })
    .on_conflict(
        OnConflict::columns([
            automation_message::Column::AutomationId,
            automation_message::Column::SourceKey,
            automation_message::Column::MessageKey,
        ])
        .do_nothing()
        .to_owned(),
    )
    .do_nothing()
    .exec(conn)
    .await?;
    Ok(())
}
pub async fn pending(
    conn: &DatabaseConnection,
    id: i32,
    source: &str,
) -> Result<Vec<Model>, DbError> {
    Ok(automation_message::Entity::find()
        .filter(automation_message::Column::AutomationId.eq(id))
        .filter(automation_message::Column::SourceKey.eq(source))
        .filter(automation_message::Column::RunId.is_null())
        .order_by_asc(automation_message::Column::Id)
        .limit(50)
        .all(conn)
        .await?)
}
pub async fn claim(conn: &DatabaseConnection, rows: &[Model], run_id: i32) -> Result<(), DbError> {
    let txn = conn.begin().await?;
    let changed = automation_message::Entity::update_many()
        .col_expr(automation_message::Column::RunId, Expr::value(run_id))
        .filter(automation_message::Column::Id.is_in(rows.iter().map(|r| r.id)))
        .filter(automation_message::Column::RunId.is_null())
        .exec(&txn)
        .await?;
    if changed.rows_affected != rows.len() as u64 {
        txn.rollback().await?;
        return Err(DbError::Validation(
            "message batch was already claimed".into(),
        ));
    }
    txn.commit().await?;
    Ok(())
}
pub async fn queue_status(
    conn: &DatabaseConnection,
    id: i32,
    source: &str,
) -> Result<(u64, Option<DateTime<Utc>>), DbError> {
    let query = automation_message::Entity::find()
        .filter(automation_message::Column::AutomationId.eq(id))
        .filter(automation_message::Column::SourceKey.eq(source));
    let count = query
        .clone()
        .filter(automation_message::Column::RunId.is_null())
        .count(conn)
        .await?;
    let last = query
        .order_by_desc(automation_message::Column::Id)
        .one(conn)
        .await?;
    Ok((count, last.map(|r| r.received_at)))
}
