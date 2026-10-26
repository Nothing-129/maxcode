//! Read-only fallback for Codex retries that never reach app-server's `error`
//! notification (notably a long 429 Retry-After sleep). Never replay old logs,
//! infer a retry from silence, change Codex configuration, or resend a prompt.
use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags, OptionalExtension};

use super::types::AcpEvent;

#[derive(Clone)]
pub(super) struct RetryLogCursor {
    path: PathBuf,
    thread_id: String,
    after_ms: u64,
    last_id: i64,
}

impl RetryLogCursor {
    pub(super) fn new(path: PathBuf, thread_id: String, after_ms: u64) -> Self {
        Self {
            path,
            thread_id,
            after_ms,
            last_id: 0,
        }
    }

    pub(super) fn observe_output(&mut self, now_ms: u64) {
        // A retry discovered late must not overwrite output that already resumed.
        self.after_ms = now_ms;
    }

    pub(super) async fn poll(&mut self) -> Option<AcpEvent> {
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
        // No CREATE, migrations, writes, full-table scan, or long busy wait.
        // An absent database/changed schema simply leaves ACP authoritative.
        let db = Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        db.busy_timeout(std::time::Duration::from_millis(25))?;
        let row = db.query_row(
            "SELECT id, ts, ts_nanos, feedback_log_body FROM logs INDEXED BY idx_logs_thread_id_ts
             WHERE thread_id = ?1 AND ts >= ?2 AND id > ?3
               AND target = 'codex_core::responses_retry' AND level = 'WARN'
             ORDER BY ts DESC, ts_nanos DESC, id DESC LIMIT 1",
            rusqlite::params![self.thread_id, (self.after_ms / 1000) as i64, self.last_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, u32>(2)?, row.get::<_, String>(3)?)),
        ).optional()?;
        let Some((id, seconds, nanos, body)) = row else {
            return Ok(None);
        };
        self.last_id = id;
        let at_ms = (seconds.max(0) as u64).saturating_mul(1000) + u64::from(nanos / 1_000_000);
        if at_ms < self.after_ms {
            return Ok(None);
        }
        Ok(parse_retry(&body, at_ms))
    }
}

fn parse_retry(body: &str, at_ms: u64) -> Option<AcpEvent> {
    let (_, tail) = body.rsplit_once("stream disconnected - retrying sampling request (")?;
    let (counters, tail) = tail.split_once(" in ")?;
    let (attempt, max) = counters.split_once('/')?;
    let attempt: u32 = attempt.parse().ok()?;
    let max_retries: u32 = max.parse().ok()?;
    let (seconds, _) = tail.split_once("s)")?;
    let seconds: f64 = seconds.parse().ok()?;
    if attempt == 0
        || max_retries < attempt
        || !seconds.is_finite()
        || !(0.0..=604800.0).contains(&seconds)
    {
        return None;
    }
    let delay_ms = (seconds * 1000.0).ceil() as u64;
    let status = body
        .rsplit_once("last status: ")
        .and_then(|(_, tail)| tail.split_whitespace().next()?.parse::<i64>().ok())
        .filter(|n| (100..=599).contains(n));
    Some(AcpEvent::TurnRetrying {
        // Do NOT forward the diagnostic body: spans may contain workspace paths,
        // request metadata or credentials. The UI localizes the known 429 cause.
        message: "Model request interrupted".into(),
        error_status: status,
        attempt: Some(attempt),
        max_retries: Some(max_retries),
        retry_delay_ms: Some(delay_ms),
        retry_at_ms: Some(at_ms.saturating_add(delay_ms)),
    })
}

#[cfg(test)]
#[path = "../../../src/maxcode-contracts/codex-retry-status.contract.rs"]
mod contract;
