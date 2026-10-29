use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub use crate::db::entities::automation::{IsolationMode, TriggerKind};
pub use crate::db::entities::automation_run::AutomationRunStatus;

/// A saved, schedulable, replayable composer launch. Wire form mirrors
/// `src/lib/types.ts` (`Automation`).
#[derive(Debug, Clone, Serialize)]
pub struct AutomationInfo {
    pub id: i32,
    pub name: String,
    pub enabled: bool,
    pub trigger_kind: TriggerKind,
    pub cron: Option<String>,
    pub timezone: String,
    pub next_run_at: Option<DateTime<Utc>>,
    pub agent_type: String,
    pub root_folder_id: Option<i32>,
    pub isolation: IsolationMode,
    pub branch: Option<String>,
    pub is_remote_branch: bool,
    /// Opaque captured composer snapshot (see `AutomationConfig`); replayed
    /// wholesale at fire, never queried.
    pub config: serde_json::Value,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_run_status: Option<String>,
    pub last_run_conversation_id: Option<i32>,
    pub unseen_failures: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One launch+settle of an automation. Wire form mirrors `AutomationRun` in
/// `types.ts`. `connection_id` is intentionally omitted (internal correlation).
#[derive(Debug, Clone, Serialize)]
pub struct AutomationRunInfo {
    pub id: i32,
    pub automation_id: i32,
    pub status: AutomationRunStatus,
    pub trigger: String,
    pub scheduled_for: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub conversation_id: Option<i32>,
    pub worktree_folder_id: Option<i32>,
    pub stop_reason: Option<String>,
    pub error: Option<String>,
    pub summary: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Full create/update payload — the editor loads the whole automation and saves
/// it back wholesale (a "saved composer" has no partial-patch semantics).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationDraft {
    pub name: String,
    pub enabled: bool,
    pub trigger_kind: TriggerKind,
    pub cron: Option<String>,
    pub timezone: String,
    pub agent_type: String,
    pub root_folder_id: Option<i32>,
    pub isolation: IsolationMode,
    pub branch: Option<String>,
    pub is_remote_branch: bool,
    pub config: serde_json::Value,
}

/// What firing the automation does. Lives inside the config blob (not a
/// column) so every pre-existing row deserializes as the legacy default —
/// nothing queries automations by action.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationAction {
    /// Launch a headless agent session (the original behavior).
    #[default]
    LaunchSession,
    /// Enqueue a work task (status todo) on the target folder's board; the
    /// work-task engine owns the actual execution.
    EnqueueTask,
}

/// The structured shape stored inside `automation.config`. Kept tolerant
/// (`#[serde(default)]`) so an older/newer snapshot still deserializes; the fire
/// path reads `action` + `prompt_blocks` + `mode_id` + `config_values`, the
/// rest is display.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AutomationConfig {
    #[serde(default)]
    pub todo_origins: Vec<crate::todo::conversation_groups::TodoOrigin>,
    #[serde(default)]
    pub session_mode: AutomationSessionMode,
    #[serde(default)]
    pub message_trigger: Option<AutomationMessageTrigger>,
    #[serde(default)]
    pub action: AutomationAction,
    #[serde(default)]
    pub prompt_blocks: Vec<serde_json::Value>,
    #[serde(default)]
    pub display_text: String,
    #[serde(default)]
    pub mode_id: Option<String>,
    #[serde(default)]
    pub config_values: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub label_snapshot: Option<serde_json::Value>,
}

/// Reuse is explicit and restricted to folderless chats, so a worktree is never
/// silently substituted and older saved automations keep their original behavior.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationSessionMode {
    #[default]
    NewPerRun,
    ReuseChat,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AutomationMessageScope {
    AtMe,
    Sender,
    Group,
    AllDirect,
    AllGroup,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutomationMessageTrigger {
    pub scope: AutomationMessageScope,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub keywords: String,
    #[serde(default)]
    pub batch_minutes: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct AutomationListenerInfo {
    pub state: String,
    pub error: Option<String>,
    pub pending_count: u64,
    pub last_received_at: Option<DateTime<Utc>>,
}
