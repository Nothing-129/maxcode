//! Host-owned workspace view state shared by Electron and web clients.
use std::collections::BTreeMap;

use sea_orm::{
    sea_query::OnConflict, ActiveValue::NotSet, ColumnTrait, EntityTrait, QueryFilter, Set,
};
use serde::Deserialize;

use crate::{
    app_error::AppCommandError,
    db::{entities::app_metadata, service::app_metadata_service},
    web::event_bridge::{emit_event, EventEmitter},
};

pub const EVENT: &str = "workspace-preferences://changed";
const PREFIX: &str = "workspace_view:";
pub const KEYS: &[&str] = &[
    "workspace:sidebar-folder-expanded",
    "workspace:sidebar-folder-group-expanded",
    "workspace:sidebar-todo-group-expanded",
    "workspace:sidebar-show-completed",
    "workspace:sidebar-show-worktrees",
    "workspace:sidebar-show-recent",
    "workspace:sidebar-show-todos",
    "workspace:sidebar-recent-filter",
    "workspace:sidebar-nav-items",
    "workspace:sidebar-sort-mode",
    "workspace:sidebar-section-order",
    "workspace:sidebar-section-collapsed",
    "workspace:sidebar-conversation-expanded",
    "workspace:left-sidebar",
    "workspace:right-sidebar",
];

pub async fn load(
    conn: &sea_orm::DatabaseConnection,
) -> Result<BTreeMap<String, String>, AppCommandError> {
    let rows = app_metadata::Entity::find()
        .filter(app_metadata::Column::Key.is_in(KEYS.iter().map(|key| format!("{PREFIX}{key}"))))
        .filter(app_metadata::Column::DeletedAt.is_null())
        .all(conn)
        .await
        .map_err(crate::db::error::DbError::from)
        .map_err(AppCommandError::from)?;
    Ok(rows
        .into_iter()
        .map(|row| (row.key[PREFIX.len()..].to_string(), row.value))
        .collect())
}

#[derive(Deserialize)]
pub struct Write {
    pub key: String,
    pub value: String,
    /// Atomic insert-only migration: never replace an existing host value.
    #[serde(default)]
    pub initialize_only: bool,
}

pub async fn save(
    conn: &sea_orm::DatabaseConnection,
    emitter: &EventEmitter,
    write: Write,
) -> Result<String, AppCommandError> {
    if !KEYS.contains(&write.key.as_str()) || write.value.len() > 256 * 1024 {
        return Err(AppCommandError::configuration_invalid(
            "Invalid workspace preference",
        ));
    }
    let db_key = format!("{PREFIX}{}", write.key);
    if write.initialize_only {
        let now = chrono::Utc::now();
        app_metadata::Entity::insert(app_metadata::ActiveModel {
            id: NotSet,
            key: Set(db_key.clone()),
            value: Set(write.value),
            created_at: Set(now),
            updated_at: Set(now),
            deleted_at: NotSet,
        })
        .on_conflict(
            OnConflict::column(app_metadata::Column::Key)
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(conn)
        .await
        .map_err(crate::db::error::DbError::from)
        .map_err(AppCommandError::from)?;
    } else {
        app_metadata_service::upsert_value(conn, &db_key, &write.value)
            .await
            .map_err(AppCommandError::from)?;
    }
    let value = app_metadata_service::get_value(conn, &db_key)
        .await
        .map_err(AppCommandError::from)?
        .unwrap_or_default();
    emit_event(
        emitter,
        EVENT,
        &serde_json::json!({"key": write.key, "value": value}),
    );
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migration_preserves_host_and_updates_do_not_clobber_other_keys() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let write = |key: &str, value: &str, initialize_only| Write {
            key: key.into(),
            value: value.into(),
            initialize_only,
        };
        save(&db.conn, &EventEmitter::Noop, write(KEYS[0], "host", false))
            .await
            .unwrap();
        assert_eq!(
            save(&db.conn, &EventEmitter::Noop, write(KEYS[0], "stale", true))
                .await
                .unwrap(),
            "host"
        );
        save(
            &db.conn,
            &EventEmitter::Noop,
            write(KEYS[1], "other", false),
        )
        .await
        .unwrap();
        let values = load(&db.conn).await.unwrap();
        assert_eq!(values[KEYS[0]], "host");
        assert_eq!(values[KEYS[1]], "other");
        assert!(save(
            &db.conn,
            &EventEmitter::Noop,
            write("arbitrary", "x", false)
        )
        .await
        .is_err());
    }
}
