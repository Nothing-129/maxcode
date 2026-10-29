//! Read-only fallback for explicit auto-compaction request spans and server
//! keepalives that Codex does not forward through ACP. Never infer from silence.
use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags, OptionalExtension};

use super::types::AcpEvent;

#[derive(Clone)]
pub(super) struct CompactionLogCursor {
    path: PathBuf,
    thread_id: String,
    after_ms: u64,
    last_id: i64,
    active: Option<String>,
    native: bool,
}

impl CompactionLogCursor {
    pub(super) fn new(path: PathBuf, thread_id: String, after_ms: u64) -> Self {
        Self {
            path,
            thread_id,
            after_ms,
            last_id: 0,
            active: None,
            native: false,
        }
    }

    pub(super) async fn poll(&mut self) -> Option<AcpEvent> {
        if self.native || self.active.is_some() {
            return None;
        }
        let mut cursor = self.clone();
        let (next, event) = tokio::task::spawn_blocking(move || {
            let event = cursor.read().ok().flatten();
            (cursor, event)
        })
        .await
        .ok()?;
        *self = next;
        event
    }

    fn read(&mut self) -> rusqlite::Result<Option<AcpEvent>> {
        let db = Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        db.busy_timeout(std::time::Duration::from_millis(25))?;
        let row = db.query_row(
            "SELECT id, ts, ts_nanos FROM logs INDEXED BY idx_logs_thread_id_ts
             WHERE thread_id = ?1 AND ts >= ?2 AND id > ?3
               AND (
                 (target = 'codex_core::client'
                  AND feedback_log_body LIKE '%:run_auto_compact{%')
                 OR (target = 'codex_api::sse::responses'
                  AND feedback_log_body LIKE '%unhandled responses event: \"response.compaction.compacting\"')
               )
             ORDER BY ts DESC, ts_nanos DESC, id DESC LIMIT 1",
            rusqlite::params![self.thread_id, (self.after_ms / 1000) as i64, self.last_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, u32>(2)?)),
        ).optional()?;
        let Some((id, seconds, nanos)) = row else {
            return Ok(None);
        };
        self.last_id = id;
        let at_ms = (seconds.max(0) as u64).saturating_mul(1000) + u64::from(nanos / 1_000_000);
        if at_ms < self.after_ms {
            return Ok(None);
        }
        let call_id = format!("codex-server-compaction:{id}");
        self.active = Some(call_id.clone());
        Ok(Some(AcpEvent::ToolCall {
            tool_call_id: call_id,
            title: "Context compaction".into(),
            kind: "think".into(),
            status: "in_progress".into(),
            content: None,
            raw_input: None,
            raw_output: None,
            locations: None,
            meta: Some(serde_json::json!({"contextCompaction": {"version": 1}})),
            images: None,
        }))
    }

    /// Fresh output proves the pre-answer compaction no longer blocks the turn.
    /// Advance the freshness boundary even if polling has not seen its log yet.
    pub(super) fn finish(&mut self, now_ms: u64, status: &str) -> Option<AcpEvent> {
        self.after_ms = now_ms;
        Some(AcpEvent::ToolCallUpdate {
            tool_call_id: self.active.take()?,
            title: None,
            status: Some(status.into()),
            content: None,
            raw_input: None,
            raw_output: None,
            raw_output_append: None,
            locations: None,
            meta: None,
            images: None,
        })
    }

    pub(super) fn observe_native(&mut self, now_ms: u64) -> Option<AcpEvent> {
        self.native = true;
        self.finish(now_ms, "completed")
    }
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/codex-compaction-status.contract.rs"]
mod contract;
