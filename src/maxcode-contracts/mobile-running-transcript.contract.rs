use super::*;
use crate::acp::session_state::PendingUserMessage;
use crate::acp::types::UserMessageBlock;
use crate::commands::conversations::apply_in_flight_message_id;

fn fixture(missing_timestamp: bool) -> ConversationDetail {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("running.jsonl");
    let mut lines = [
        serde_json::json!({"timestamp": "2026-10-16T11:09:49Z", "type": "session_meta",
            "payload": {"id": "running", "cwd": "/work"}}),
        serde_json::json!({"timestamp": "2026-10-16T11:09:50Z", "type": "response_item",
            "payload": {"type": "message", "role": "user",
                "content": [{"type": "input_text", "text": "publish changes"}]}}),
        serde_json::json!({"timestamp": "2026-10-16T11:09:53Z", "type": "response_item",
            "payload": {"type": "message", "role": "assistant", "phase": "commentary",
                "content": [{"type": "output_text", "text": "Checking changes."}]}}),
        serde_json::json!({"timestamp": "2026-10-16T11:17:10Z", "type": "response_item",
            "payload": {"type": "message", "role": "assistant", "phase": "commentary",
                "content": [{"type": "output_text", "text": "Uploading the build."}]}}),
    ];
    if missing_timestamp {
        lines[1].as_object_mut().unwrap().remove("timestamp");
    }
    std::fs::write(
        &path,
        lines
            .iter()
            .map(|line| format!("{line}\n"))
            .collect::<String>(),
    )
    .unwrap();
    CodexParser::new()
        .parse_conversation_detail(&path, "running")
        .unwrap()
}

fn pending() -> PendingUserMessage {
    PendingUserMessage {
        message_id: "broadcast-prompt".into(),
        blocks: vec![UserMessageBlock::Text {
            text: "publish changes".into(),
        }],
    }
}

#[test]
fn first_codex_round_keeps_its_live_anchor_after_completed_commentary() {
    let mut detail = fixture(false);
    assert!(detail.source_timestamps);
    assert!(serde_json::to_value(&detail)
        .unwrap()
        .get("source_timestamps")
        .is_none());
    assert!(detail
        .turns
        .iter()
        .any(|t| matches!(t.role, TurnRole::Assistant) && t.completed_at.is_some()));
    let count = detail.turns.len();
    let id = apply_in_flight_message_id(
        &mut detail.turns,
        &pending(),
        Some("2026-10-16T11:09:49.500Z".parse().unwrap()),
        detail.source_timestamps,
    );
    assert_eq!(id.as_deref(), Some("broadcast-prompt"));
    assert_eq!(
        detail.turns.len(),
        count,
        "persisted content stays available to non-streaming readers"
    );
}

#[test]
fn identical_older_prompt_is_not_reused_for_a_new_running_round() {
    let mut detail = fixture(false);
    assert_eq!(
        apply_in_flight_message_id(
            &mut detail.turns,
            &pending(),
            Some("2026-10-16T11:18:00Z".parse().unwrap()),
            detail.source_timestamps,
        ),
        None
    );
}

#[test]
fn missing_record_time_retains_the_conservative_ambiguity_guard() {
    let mut detail = fixture(true);
    assert!(!detail.source_timestamps);
    // Emulate fallback parsers whose every message receives the parse instant:
    // no older turn can act as the recency witness.
    for turn in &mut detail.turns {
        turn.timestamp = "2026-10-16T11:20:00Z".parse().unwrap();
    }
    assert_eq!(
        apply_in_flight_message_id(
            &mut detail.turns,
            &pending(),
            Some("2026-10-16T11:09:49.500Z".parse().unwrap()),
            detail.source_timestamps,
        ),
        None
    );
}
