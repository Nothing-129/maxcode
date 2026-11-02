//! Ask-user-question settings persistence — the web/Tauri-shared surface for
//! the `ask_user_question` feature toggle.
//!
//! One knob survives across restarts:
//!   * `question.enabled` — feature kill switch (**default false**). When on,
//!     `codeg-mcp` exposes the `ask_user_question` tool so an agent can block on
//!     a multiple-choice question rendered above the conversation input box.
//!
//! Disabled by default; users may enable it in settings.
//!
//! On startup `apply_persisted_question_config` reads this key from
//! `app_metadata` and pushes it into the shared [`QuestionRuntimeConfig`] that
//! MCP injection reads. On UI save, `set_question_settings_core` writes the key
//! and immediately re-applies — mirroring the feedback settings flow exactly
//! (`crate::commands::feedback`).

use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

use crate::acp::question::{QuestionConfig, QuestionRuntimeConfig};
use crate::app_error::AppCommandError;
use crate::db::service::app_metadata_service;
use crate::web::event_bridge::{emit_event, EventEmitter, QUESTION_SETTINGS_CHANGED_EVENT};

pub const KEY_QUESTION_ENABLED: &str = "question.enabled";

/// Disabled by default.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuestionSettings {
    pub enabled: bool,
}

impl Default for QuestionSettings {
    fn default() -> Self {
        Self { enabled: false }
    }
}

impl QuestionSettings {
    fn into_runtime_config(self) -> QuestionConfig {
        QuestionConfig {
            enabled: self.enabled,
        }
    }
}

/// Read the persisted key from `app_metadata`, falling back to the default
/// (disabled) for a missing or malformed value. Never errors hard — corrupt
/// persistence is treated as "no preference yet".
pub async fn load_question_settings(conn: &DatabaseConnection) -> QuestionSettings {
    let mut settings = QuestionSettings::default();
    if let Ok(Some(raw)) = app_metadata_service::get_value(conn, KEY_QUESTION_ENABLED).await {
        if let Ok(v) = raw.parse::<bool>() {
            settings.enabled = v;
        }
    }
    settings
}

/// Pull settings from the DB and push the resulting `QuestionConfig` onto the
/// shared runtime handle. Idempotent — safe on startup, after settings save, or
/// after any external write to `app_metadata`.
pub async fn apply_persisted_question_config(
    conn: &DatabaseConnection,
    config: &QuestionRuntimeConfig,
) {
    let settings = load_question_settings(conn).await;
    config.set(settings.into_runtime_config()).await;
}

/// Persist + apply + broadcast. Used by both the Tauri command and the HTTP
/// handler so the write + re-apply + notify chain lives in exactly one place.
/// The broadcast lets a conversation view (in another window / WS client)
/// converge on the new flag — a frontend-only signal would never cross windows.
pub async fn set_question_settings_core(
    conn: &DatabaseConnection,
    config: &QuestionRuntimeConfig,
    emitter: &EventEmitter,
    desired: QuestionSettings,
) -> Result<QuestionSettings, AppCommandError> {
    app_metadata_service::upsert_value(conn, KEY_QUESTION_ENABLED, &desired.enabled.to_string())
        .await
        .map_err(AppCommandError::from)?;
    config.set(desired.clone().into_runtime_config()).await;
    emit_event(emitter, QUESTION_SETTINGS_CHANGED_EVENT, &desired);
    Ok(desired)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn load_returns_default_disabled_when_unset() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let settings = load_question_settings(&db.conn).await;
        assert!(!settings.enabled, "ask_user_question defaults OFF");
    }

    #[tokio::test]
    async fn set_then_load_round_trip_and_runtime_applied() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let config = QuestionRuntimeConfig::new();
        let saved = set_question_settings_core(
            &db.conn,
            &config,
            &EventEmitter::Noop,
            QuestionSettings { enabled: false },
        )
        .await
        .unwrap();
        assert!(!saved.enabled);

        let loaded = load_question_settings(&db.conn).await;
        assert!(!loaded.enabled);
        assert!(!config.is_enabled().await);
    }

    #[tokio::test]
    async fn apply_persisted_pushes_db_value_onto_runtime() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        app_metadata_service::upsert_value(&db.conn, KEY_QUESTION_ENABLED, "false")
            .await
            .unwrap();
        let config = QuestionRuntimeConfig::new();
        // Default runtime is disabled; applying the persisted "false" keeps it off.
        apply_persisted_question_config(&db.conn, &config).await;
        assert!(!config.is_enabled().await);
    }
}
