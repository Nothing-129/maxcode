use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

use crate::db::entities::conversation_share;
use crate::db::error::DbError;

pub async fn publish(
    conn: &DatabaseConnection,
    conversation_id: i32,
    snapshot_json: String,
) -> Result<conversation_share::Model, DbError> {
    let now = Utc::now();
    let existing = conversation_share::Entity::find()
        .filter(conversation_share::Column::ConversationId.eq(conversation_id))
        .one(conn)
        .await?;

    if let Some(row) = existing {
        let was_revoked = row.revoked_at.is_some();
        let mut active: conversation_share::ActiveModel = row.into();
        // Revocation permanently burns the old capability. Publishing again
        // gets a new token so a previously copied link never comes back alive.
        if was_revoked {
            active.token = Set(new_token());
        }
        active.snapshot_json = Set(snapshot_json);
        active.updated_at = Set(now);
        active.revoked_at = Set(None);
        return active.update(conn).await.map_err(Into::into);
    }

    conversation_share::ActiveModel {
        conversation_id: Set(conversation_id),
        token: Set(new_token()),
        snapshot_json: Set(snapshot_json),
        created_at: Set(now),
        updated_at: Set(now),
        revoked_at: Set(None),
        ..Default::default()
    }
    .insert(conn)
    .await
    .map_err(Into::into)
}

pub async fn revoke(conn: &DatabaseConnection, conversation_id: i32) -> Result<bool, DbError> {
    let row = conversation_share::Entity::find()
        .filter(conversation_share::Column::ConversationId.eq(conversation_id))
        .one(conn)
        .await?;
    let Some(row) = row else {
        return Ok(false);
    };
    if row.revoked_at.is_some() {
        return Ok(false);
    }
    let mut active: conversation_share::ActiveModel = row.into();
    active.revoked_at = Set(Some(Utc::now()));
    active.update(conn).await?;
    Ok(true)
}

pub async fn find_active_by_token(
    conn: &DatabaseConnection,
    token: &str,
) -> Result<Option<conversation_share::Model>, DbError> {
    Ok(conversation_share::Entity::find()
        .filter(conversation_share::Column::Token.eq(token))
        .filter(conversation_share::Column::RevokedAt.is_null())
        .one(conn)
        .await?)
}

fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::service::{conversation_service, folder_service};
    use crate::db::test_helpers::fresh_in_memory_db;
    use crate::models::AgentType;

    #[tokio::test]
    async fn revocation_burns_the_old_capability() {
        let conn = fresh_in_memory_db().await;
        let folder = folder_service::add_folder(&conn.conn, "/tmp/codeg-share-test")
            .await
            .expect("folder");
        let conversation = conversation_service::create(
            &conn.conn,
            folder.id,
            AgentType::Codex,
            Some("Shared".to_string()),
            None,
        )
        .await
        .expect("conversation");

        let first = publish(&conn.conn, conversation.id, "{\"version\":1}".to_string())
            .await
            .expect("publish");
        assert!(find_active_by_token(&conn.conn, &first.token)
            .await
            .expect("lookup")
            .is_some());

        assert!(revoke(&conn.conn, conversation.id).await.expect("revoke"));
        assert!(find_active_by_token(&conn.conn, &first.token)
            .await
            .expect("old lookup")
            .is_none());

        let second = publish(&conn.conn, conversation.id, "{\"version\":1}".to_string())
            .await
            .expect("republish");
        assert_ne!(second.token, first.token);
    }
}
