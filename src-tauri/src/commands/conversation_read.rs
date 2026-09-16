//! Durable per-conversation read receipts, shared by all clients of this backend.
use crate::app_error::AppCommandError;
use crate::db::{entities::app_metadata, service::app_metadata_service};
use crate::web::event_bridge::{emit_event, EventEmitter};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};

const PREFIX: &str = "conversation_read:";
pub const EVENT: &str = "conversation-read://changed";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReadReceipt {
    pub conversation_id: i64,
    pub receipt: String,
}

pub async fn load(conn: &DatabaseConnection) -> Result<Vec<ReadReceipt>, AppCommandError> {
    let rows = app_metadata::Entity::find()
        .filter(app_metadata::Column::Key.starts_with(PREFIX))
        .all(conn)
        .await
        .map_err(crate::db::error::DbError::from)
        .map_err(AppCommandError::from)?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(ReadReceipt {
                conversation_id: row.key.strip_prefix(PREFIX)?.parse().ok()?,
                receipt: row.value,
            })
        })
        .collect())
}

pub async fn save(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    ids: Vec<i64>,
) -> Result<Vec<ReadReceipt>, AppCommandError> {
    let mut saved = Vec::new();
    for id in ids.into_iter().filter(|id| *id > 0) {
        let value = ReadReceipt {
            conversation_id: id,
            receipt: uuid::Uuid::new_v4().to_string(),
        };
        app_metadata_service::upsert_value(conn, &format!("{PREFIX}{id}"), &value.receipt)
            .await
            .map_err(AppCommandError::from)?;
        // Broadcast each committed receipt even if a later write fails.
        emit_event(emitter, EVENT, &value);
        saved.push(value);
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn receipts_survive_reload_and_reads_do_not_replace_other_conversations() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        assert!(load(&db.conn).await.unwrap().is_empty());
        let first = save(&db.conn, &EventEmitter::Noop, vec![7, 8])
            .await
            .unwrap();
        let second = save(&db.conn, &EventEmitter::Noop, vec![7, -1, 0])
            .await
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_ne!(first[0].receipt, second[0].receipt);
        let loaded = load(&db.conn).await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(
            loaded
                .iter()
                .find(|r| r.conversation_id == 7)
                .unwrap()
                .receipt,
            second[0].receipt
        );
        assert_eq!(
            loaded
                .iter()
                .find(|r| r.conversation_id == 8)
                .unwrap()
                .receipt,
            first[1].receipt
        );
    }
}
