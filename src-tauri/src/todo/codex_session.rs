//! Native Codex handoff through a todo. Recovery data is member-only and never
//! returned by the public transcript endpoint. Imports always get a new UUID.

use std::io::Write;
use std::path::{Path, PathBuf};

use sea_orm::{ActiveModelTrait, Set};

use super::conversation_groups::{normalized_id, TodoOrigin};
use super::*;
use crate::db::entities::conversation::{self, ConversationKind, ConversationStatus};
use crate::db::service::{agent_setting_service, conversation_service, folder_service};
use crate::models::{AgentType, DbConversationSummary};
use crate::parsers::codex::{resolve_codex_home_dir_for_env, CodexParser};

#[derive(Clone, Serialize, Deserialize)]
pub struct CodexSessionTransfer {
    pub version: u8,
    pub rollout: String,
    pub title: Option<String>,
}

#[derive(Deserialize)]
pub struct ImportRequest {
    pub origin: TodoOrigin,
    pub folder_id: i32,
}

fn invalid() -> AppCommandError {
    AppCommandError::invalid_input("Invalid or unsupported Codex session data")
}

impl CodexSessionTransfer {
    pub(super) fn validate(&self) -> Result<Vec<serde_json::Value>, AppCommandError> {
        if self.version != 1 || self.rollout.len() > MAX_SHARE_BYTES {
            return Err(invalid());
        }
        let records = self
            .rollout
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str::<serde_json::Value>(line).map_err(|_| invalid()))
            .collect::<Result<Vec<_>, _>>()?;
        let header = records.first().ok_or_else(invalid)?;
        if header["type"] != "session_meta"
            || header["payload"]["id"]
                .as_str()
                .and_then(|id| Uuid::parse_str(id).ok())
                .is_none()
            || !records
                .iter()
                .all(|r| r.is_object() && r["type"].is_string() && r["payload"].is_object())
            || records.iter().skip(1).any(|r| r["type"] == "session_meta")
            || !records.iter().any(|r| r["type"] == "response_item")
        {
            return Err(invalid());
        }
        Ok(records)
    }
}

pub(super) async fn export(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<CodexSessionTransfer, AppCommandError> {
    let summary = conversation_service::get_by_id(conn, conversation_id)
        .await
        .map_err(AppCommandError::from)?;
    if summary.agent_type != AgentType::Codex {
        return Err(AppCommandError::invalid_input(
            "Only Codex sessions support todo import",
        ));
    }
    let id = summary
        .external_id
        .ok_or_else(|| AppCommandError::invalid_input("Codex session has no saved history yet"))?;
    let env = agent_setting_service::load_agent_env(conn, AgentType::Codex).await;
    let rollout =
        tokio::task::spawn_blocking(move || CodexParser::for_env(&env).export_rollout(&id))
            .await
            .map_err(|_| invalid())?
            .map_err(|err| {
                AppCommandError::invalid_input("Cannot export Codex history")
                    .with_detail(err.to_string())
            })?;
    let transfer = CodexSessionTransfer {
        version: 1,
        rollout,
        title: summary.title,
    };
    transfer.validate()?;
    Ok(transfer)
}

/// Keep transcript text verbatim; only execution metadata is mapped to the
/// receiver. File contents, credentials, hooks and CLI configuration are never
/// copied. Local adapter settings decide permissions when the session resumes.
fn prepare(
    transfer: &CodexSessionTransfer,
    id: &str,
    cwd: &Path,
) -> Result<String, AppCommandError> {
    let mut records = transfer.validate()?;
    let original_id = records[0]["payload"]["id"]
        .as_str()
        .ok_or_else(invalid)?
        .to_string();
    let header = records[0]["payload"].as_object_mut().ok_or_else(invalid)?;
    header.insert("id".into(), id.into());
    header.insert("cwd".into(), cwd.to_string_lossy().as_ref().into());
    if header.contains_key("runtime_workspace_roots") {
        header.insert(
            "runtime_workspace_roots".into(),
            serde_json::json!([cwd.to_string_lossy()]),
        );
    }
    for key in [
        "history_base",
        "forked_from_id",
        "forked_from_ordinal_exclusive",
        "parent_thread_id",
        "subagent_history_start_ordinal",
        "source",
        "git",
    ] {
        header.remove(key);
    }
    header.insert("source".into(), "cli".into());
    let mut output = String::new();
    for (index, record) in records.iter_mut().enumerate() {
        if record.get("ordinal").is_some() {
            record["ordinal"] = index.into();
        }
        let is_context = record["type"] == "turn_context";
        let payload = record["payload"].as_object_mut().ok_or_else(invalid)?;
        for key in ["session_id", "thread_id"] {
            if payload.get(key).and_then(serde_json::Value::as_str) == Some(&original_id) {
                payload.insert(key.into(), id.into());
            }
        }
        if is_context {
            payload.insert("cwd".into(), cwd.to_string_lossy().as_ref().into());
            if payload.contains_key("workspace_roots") {
                payload.insert(
                    "workspace_roots".into(),
                    serde_json::json!([cwd.to_string_lossy()]),
                );
            }
            // Required native fields remain deserializable; resume overrides
            // these conservative historical defaults with the local settings.
            payload.insert("approval_policy".into(), "on-request".into());
            payload.insert(
                "sandbox_policy".into(),
                serde_json::json!({"type":"read-only"}),
            );
            for key in [
                "permissions",
                "additional_directories",
                "permission_profile",
                "file_system_sandbox_policy",
            ] {
                payload.remove(key);
            }
        }
        output.push_str(&serde_json::to_string(record).map_err(|_| invalid())?);
        output.push('\n');
    }
    Ok(output)
}

fn write_rollout(home: &Path, id: &str, data: &str) -> Result<PathBuf, AppCommandError> {
    let now = Utc::now();
    let directory = home
        .join("sessions")
        .join(now.format("%Y/%m/%d").to_string());
    std::fs::create_dir_all(&directory).map_err(|err| {
        AppCommandError::invalid_input("Cannot create Codex session directory")
            .with_detail(err.to_string())
    })?;
    let path = directory.join(format!(
        "rollout-{}-{id}.jsonl",
        now.format("%Y-%m-%dT%H-%M-%S")
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|err| {
        AppCommandError::invalid_input("Cannot write Codex session").with_detail(err.to_string())
    })?;
    if let Err(err) = file
        .write_all(data.as_bytes())
        .and_then(|_| file.sync_all())
    {
        let _ = std::fs::remove_file(&path);
        return Err(AppCommandError::invalid_input("Cannot write Codex session")
            .with_detail(err.to_string()));
    }
    Ok(path)
}

static IMPORT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn import(
    conn: &DatabaseConnection,
    request: ImportRequest,
) -> Result<DbConversationSummary, AppCommandError> {
    // Capture and authorize the exact origin, independently of the active board.
    let origin = TodoOrigin {
        scope_id: if request.origin.scope_id == PERSONAL {
            PERSONAL.into()
        } else {
            normalized_id(&request.origin.scope_id)?
        },
        todo_id: normalized_id(&request.origin.todo_id)?,
    };
    let folder = folder_service::get_folder_by_id(conn, request.folder_id)
        .await
        .map_err(AppCommandError::from)?
        .filter(|f| f.kind != crate::db::entities::folder::FolderKind::Chat)
        .ok_or_else(|| AppCommandError::not_found("Choose a local project folder"))?;
    let cwd = std::fs::canonicalize(&folder.path)
        .map_err(|_| AppCommandError::not_found("Project folder is unavailable"))?;
    if !cwd.is_dir() {
        return Err(AppCommandError::invalid_input("Choose a project directory"));
    }
    let transfer = super::conversation_sources::codex_session(conn, &origin).await?;
    let _guard = IMPORT_LOCK.lock().await;
    let existing = rows(conn, "SELECT c.id FROM maxcode_todo_codex_import i JOIN conversation c ON c.id=i.conversation_id WHERE i.scope_id=? AND i.todo_id=? AND i.folder_id=? AND c.deleted_at IS NULL", vec![origin.scope_id.clone().into(), origin.todo_id.clone().into(), folder.id.into()]).await?;
    if let Some(row) = existing.first() {
        return conversation_service::get_by_id(conn, field(row, "id")?)
            .await
            .map_err(AppCommandError::from);
    }
    let id = Uuid::new_v4().to_string();
    let data = prepare(&transfer, &id, &cwd)?;
    let env = agent_setting_service::load_agent_env(conn, AgentType::Codex).await;
    let home = resolve_codex_home_dir_for_env(&env);
    let thread_id = id.clone();
    let path = tokio::task::spawn_blocking(move || write_rollout(&home, &id, &data))
        .await
        .map_err(|_| invalid())??;
    let result = async {
        let txn = conn.begin().await.map_err(error_db)?;
        let now = Utc::now();
        let row = conversation::ActiveModel {
            folder_id: Set(folder.id), title: Set(transfer.title), title_locked: Set(true),
            agent_type: Set("codex".into()), status: Set(ConversationStatus::PendingReview),
            kind: Set(ConversationKind::Regular),
            external_id: Set(Some(thread_id)),
            created_at: Set(now), updated_at: Set(now),
            ..Default::default()
        }.insert(&txn).await.map_err(error_db)?;
        execute(&txn, "INSERT INTO maxcode_todo_conversation_link (scope_id,todo_id,conversation_id,created_at) VALUES (?,?,?,?)", vec![origin.scope_id.clone().into(),origin.todo_id.clone().into(),row.id.into(),now.to_rfc3339().into()]).await?;
        execute(&txn, "INSERT INTO maxcode_todo_codex_import (scope_id,todo_id,folder_id,conversation_id) VALUES (?,?,?,?) ON CONFLICT(scope_id,todo_id,folder_id) DO UPDATE SET conversation_id=excluded.conversation_id", vec![origin.scope_id.into(),origin.todo_id.into(),folder.id.into(),row.id.into()]).await?;
        txn.commit().await.map_err(error_db)?;
        Ok::<_, AppCommandError>(row.id)
    }.await;
    if result.is_err() {
        let _ = std::fs::remove_file(&path);
    }
    conversation_service::get_by_id(conn, result?)
        .await
        .map_err(AppCommandError::from)
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/todo-codex-import.contract.rs"]
mod contract;
