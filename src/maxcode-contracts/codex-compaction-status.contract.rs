use super::*;

fn database(path: &std::path::Path) -> Connection {
    let db = Connection::open(path).unwrap();
    db.execute_batch("CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, thread_id TEXT, target TEXT, feedback_log_body TEXT);
        CREATE INDEX idx_logs_thread_id_ts ON logs(thread_id, ts DESC, ts_nanos DESC, id DESC);").unwrap();
    db
}

fn insert(db: &Connection, id: i64, thread: &str, ms: u64) {
    db.execute(
        "INSERT INTO logs VALUES (?1, ?2, ?3, ?4, 'codex_api::sse::responses', ?5)",
        rusqlite::params![
            id,
            (ms / 1000) as i64,
            ((ms % 1000) * 1_000_000) as i64,
            thread,
            "private span: unhandled responses event: \"response.compaction.compacting\""
        ],
    )
    .unwrap();
}

#[tokio::test]
async fn only_fresh_explicit_same_thread_compaction_is_shown_and_keepalives_do_not_duplicate() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("logs.sqlite");
    let db = database(&path);
    insert(&db, 1, "a", 100_001);
    insert(&db, 2, "b", 200_100);
    let mut cursor = CompactionLogCursor::new(path, "a".into(), 200_000);
    assert!(cursor.poll().await.is_none());
    insert(&db, 3, "a", 200_123);
    let start = cursor.poll().await.unwrap();
    let value = serde_json::to_value(&start).unwrap();
    assert_eq!(value["status"], "in_progress");
    assert_eq!(value["meta"]["contextCompaction"]["version"], 1);
    assert!(!value.to_string().contains("private span"));
    insert(&db, 4, "a", 200_500);
    assert!(cursor.poll().await.is_none());
    let end = cursor.finish(200_600, "completed").unwrap();
    assert_eq!(serde_json::to_value(end).unwrap()["status"], "completed");
    assert!(
        cursor.poll().await.is_none(),
        "late logs cannot revive finished compaction"
    );
    insert(&db, 5, "a", 201_000);
    assert!(
        cursor.poll().await.is_some(),
        "a later compaction in the same turn is allowed"
    );
    assert_eq!(
        serde_json::to_value(cursor.finish(201_100, "failed").unwrap()).unwrap()["status"],
        "failed"
    );
    assert!(cursor.finish(201_200, "failed").is_none());
    assert_eq!(
        db.query_row("SELECT count(*) FROM logs", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        5
    );
}

#[tokio::test]
async fn native_lifecycle_wins_and_missing_logs_are_not_created() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("logs.sqlite");
    let mut cursor = CompactionLogCursor::new(path.clone(), "a".into(), 0);
    assert!(cursor.poll().await.is_none());
    assert!(!path.exists());
    let db = database(&path);
    cursor.observe_native(100);
    insert(&db, 1, "a", 200);
    assert!(cursor.poll().await.is_none());
}

#[tokio::test]
async fn output_before_poll_suppresses_old_keepalive_and_snapshot_retains_the_card() {
    use crate::acp::session_state::SessionState;
    use crate::models::agent::AgentType;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("logs.sqlite");
    let db = database(&path);
    let mut cursor = CompactionLogCursor::new(path, "a".into(), 100_000);
    insert(&db, 1, "a", 100_100);
    assert!(cursor.finish(100_200, "completed").is_none());
    assert!(cursor.poll().await.is_none());
    insert(&db, 2, "a", 100_300);
    let mut state = SessionState::new("c".into(), AgentType::Codex, None, "main".into(), None);
    state.apply_event(&cursor.poll().await.unwrap());
    let snapshot = serde_json::to_string(&state.to_snapshot()).unwrap();
    assert!(snapshot.contains("contextCompaction"));
    assert!(snapshot.contains("in_progress"));
    state.apply_event(&cursor.observe_native(100_400).unwrap());
    assert!(!serde_json::to_string(&state.to_snapshot())
        .unwrap()
        .contains("in_progress"));
}

#[tokio::test]
async fn request_start_shows_before_first_keepalive_and_completes_the_same_card() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("logs.sqlite");
    let db = database(&path);
    let mut cursor = CompactionLogCursor::new(path, "a".into(), 100_000);
    // A normal response request and the preflight check are not compaction.
    for (id, body) in [
        (
            1,
            "run_turn:run_pre_sampling_compact: prepared step skill catalog",
        ),
        (
            2,
            "run_turn:model_client.stream_responses_websocket: non-incremental request",
        ),
    ] {
        db.execute(
            "INSERT INTO logs VALUES (?1, 100, 100000000, 'a', 'codex_core::client', ?2)",
            rusqlite::params![id, body],
        )
        .unwrap();
    }
    assert!(cursor.poll().await.is_none());
    db.execute("INSERT INTO logs VALUES (3, 100, 200000000, 'a', 'codex_core::client', ?1)",
        ["run_turn:run_pre_sampling_compact:run_auto_compact{reason=ContextLimit phase=PreTurn}:model_client.stream_responses_websocket: non-incremental request"]).unwrap();
    let start = serde_json::to_value(cursor.poll().await.unwrap()).unwrap();
    assert_eq!(start["status"], "in_progress");
    // The first server keepalive can be seconds later. It must not add a card.
    insert(&db, 4, "a", 107_000);
    assert!(cursor.poll().await.is_none());
    let completed = serde_json::to_value(cursor.finish(110_000, "completed").unwrap()).unwrap();
    assert_eq!(completed["tool_call_id"], start["tool_call_id"]);
    assert_eq!(completed["status"], "completed");
    assert!(cursor.poll().await.is_none());
}
