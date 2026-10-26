use super::*;
use crate::acp::session_state::SessionState;
use crate::acp::types::ConnectionStatus;
use crate::models::agent::AgentType;

fn warning(delay: &str) -> String {
    format!("session_loop{{thread_id=thread-a}}:turn{{turn.id=turn-a}}: stream disconnected - retrying sampling request (1/5 in {delay}s)... turn_id=turn-a retries=1 max_retries=5 sampling_error=exceeded retry limit, last status: 429 Too Many Requests")
}

fn database(path: &std::path::Path) -> Connection {
    let db = Connection::open(path).unwrap();
    db.execute_batch("CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, thread_id TEXT, target TEXT, level TEXT, feedback_log_body TEXT);
        CREATE INDEX idx_logs_thread_id_ts ON logs(thread_id, ts DESC, ts_nanos DESC, id DESC);").unwrap();
    db
}

fn insert(db: &Connection, id: i64, thread: &str, ms: u64, body: &str) {
    db.execute(
        "INSERT INTO logs VALUES (?1, ?2, ?3, ?4, 'codex_core::responses_retry', 'WARN', ?5)",
        rusqlite::params![
            id,
            (ms / 1000) as i64,
            ((ms % 1000) * 1_000_000) as i64,
            thread,
            body
        ],
    )
    .unwrap();
}

#[test]
fn retry_after_is_structured_without_leaking_diagnostics() {
    let event = parse_retry(&warning("328.999922375"), 100_000).unwrap();
    let json = serde_json::to_value(&event).unwrap();
    assert_eq!(json["error_status"], 429);
    assert_eq!(json["attempt"], 1);
    assert_eq!(json["max_retries"], 5);
    assert_eq!(json["retry_delay_ms"], 329_000);
    assert_eq!(json["retry_at_ms"], 429_000);
    assert!(!json.to_string().contains("thread-a"));
    assert!(!json.to_string().contains("sampling_error"));
    for delay in ["NaN", "inf", "-1", "99999999"] {
        assert!(parse_retry(&warning(delay), 0).is_none());
    }
    assert!(parse_retry("ordinary output, no retry", 0).is_none());
    assert!(parse_retry(&warning("1").replace("1/5", "6/5"), 0).is_none());
}

#[tokio::test]
async fn native_logs_are_read_only_scoped_fresh_and_not_replayed() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("logs_2.sqlite");
    let db = database(&path);
    insert(&db, 1, "thread-a", 100_001, &warning("329"));
    insert(&db, 2, "thread-b", 200_100, &warning("999"));
    let mut cursor = RetryLogCursor::new(path, "thread-a".into(), 200_000);
    assert!(cursor.poll().await.is_none());
    insert(&db, 3, "thread-a", 200_123, &warning("329"));
    let event = cursor.poll().await.unwrap();
    assert_eq!(serde_json::to_value(event).unwrap()["retry_at_ms"], 529_123);
    assert!(cursor.poll().await.is_none());
    insert(&db, 4, "thread-a", 200_500, &warning("1"));
    cursor.observe_output(200_600);
    assert!(
        cursor.poll().await.is_none(),
        "late poll cannot resurrect a recovered retry"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM logs", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        4
    );
}

#[tokio::test]
async fn missing_or_changed_logs_do_not_break_prompts_or_create_databases() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("missing.sqlite");
    assert!(RetryLogCursor::new(path.clone(), "a".into(), 0)
        .poll()
        .await
        .is_none());
    assert!(!path.exists());
    let _db = Connection::open(&path).unwrap();
    assert!(RetryLogCursor::new(path, "a".into(), 0)
        .poll()
        .await
        .is_none());
}

#[test]
fn snapshots_recover_backoff_but_output_and_turn_boundaries_clear_it() {
    let mut state = SessionState::new("c".into(), AgentType::Codex, None, "main".into(), None);
    state.apply_event(&AcpEvent::StatusChanged {
        status: ConnectionStatus::Prompting,
    });
    let event = parse_retry(&warning("329"), 100_000).unwrap();
    state.apply_event(&event);
    let snapshot = serde_json::to_value(state.to_snapshot()).unwrap();
    assert_eq!(snapshot["turn_retrying"]["retry_at_ms"], 429_000);
    state.apply_event(&AcpEvent::ContentDelta {
        text: "resumed".into(),
        parent_tool_use_id: None,
    });
    assert!(state.to_snapshot().turn_retrying.is_none());
    state.apply_event(&event);
    state.apply_event(&AcpEvent::StatusChanged {
        status: ConnectionStatus::Connected,
    });
    assert!(state.to_snapshot().turn_retrying.is_none());
    state.apply_event(&event);
    assert!(
        state.to_snapshot().turn_retrying.is_none(),
        "late retries cannot reopen an idle turn"
    );
}
