//! Independent MaxCode runtime contracts for 9d9ce6b0, 2db8a81b and b35282c6.
use super::*;
use agent_client_protocol::schema::v1::Diff;
use serde_json::{json, Value};

#[test]
fn sparse_air_state_keeps_identity_without_replaying_output() {
    let mut ledger = crate::acp::air_contract::ToolCallMetaLedger::default();
    ledger.open(AgentType::ClaudeCode, "tool", json!({"claudeCode":{"toolName":"Write","parentToolUseId":"parent"},"jetbrains":{"air":{"version":1,"subagent":true}},"terminal_output_delta":{"data":"old"}}).as_object().cloned());
    let update = ledger.update(AgentType::ClaudeCode, "tool", json!({"jetbrains":{"air":{"commandTitle":"changed"}},"terminal_output_delta":{"data":"new"}}).as_object().cloned()).unwrap();
    assert_eq!(update["claudeCode"]["toolName"], "Write");
    assert_eq!(update["claudeCode"]["parentToolUseId"], "parent");
    assert_eq!(update["terminal_output_delta"]["data"], "new");
    let status = ledger.update(AgentType::ClaudeCode, "tool", None).unwrap();
    assert_eq!(status["claudeCode"]["toolName"], "Write");
    assert!(!status.contains_key("terminal_output_delta"));
    ledger.open(AgentType::ClaudeCode, "tool", None);
    assert!(ledger.update(AgentType::ClaudeCode, "tool", None).is_none());
    assert!(crate::acp::air_contract::ToolCallMetaLedger::default()
        .update(AgentType::ClaudeCode, "tool", None)
        .is_none());
    assert!(ledger.update(AgentType::Grok, "tool", None).is_none());
}

#[test]
fn codex_hunks_and_claude_complete_inputs_remain_lossless() {
    let diff = |old: &str, new: &str| {
        ToolCallContent::Diff(Diff::new("/repo/a.ts", new).old_text(old.to_owned()))
    };
    let parts = [diff("old one", "new one"), diff("old two", "new two")];
    let value: Value =
        serde_json::from_str(&synthesize_edit_input_from_diffs(&parts).unwrap()).unwrap();
    assert_eq!(
        value["changes"]["/repo/a.ts"],
        json!([{"old_text":"old one","new_text":"new one"},{"old_text":"old two","new_text":"new two"}])
    );
    let meta = json!({"claudeCode":{"toolName":"Edit"}});
    assert!(synthesize_live_edit_input(
        AgentType::ClaudeCode,
        meta.as_object(),
        &Some(r#"{"file_path":"/repo/a.ts","old_string":"","new_string":"explicit"}"#.into()),
        &parts
    )
    .is_none());
    let missing = synthesize_live_edit_input(
        AgentType::ClaudeCode,
        meta.as_object(),
        &Some(r#"{"file_path":"/repo/a.ts","replace_all":false}"#.into()),
        &[diff("old", "new")],
    )
    .unwrap();
    let recovered: Value = serde_json::from_str(&missing).unwrap();
    assert_eq!(recovered["old_string"], "old");
    assert_eq!(recovered["new_string"], "new");
    assert_eq!(recovered["replace_all"], false);
}

#[test]
fn hosted_search_usage_does_not_become_context_occupancy() {
    use crate::acp::codex_context::{is_web_search_input, ContextReadings};
    let mut readings = ContextReadings::default();
    assert!(readings.admit(74000));
    for input in [
        json!({"type":"webSearch"}),
        json!({"query":"test","action":"search"}),
    ] {
        assert!(is_web_search_input(Some(&input)));
    }
    readings.web_search_ran();
    assert!(readings.admit(74000));
    assert!(!readings.admit(530278));
    assert!(!readings.admit(530278));
    assert!(readings.admit(79000));
    readings.web_search_ran();
    readings.turn_started();
    assert!(readings.admit(80000));
}

#[test]
fn plan_review_still_requires_the_local_shape_gate() {
    let frame = json!({"sessionId":"s","toolCall":{"toolCallId":"plan-review:p","kind":"switch_mode","rawInput":{"plan":"implement this"}},"options":[{"optionId":"implement_plan","name":"Implement","kind":"allow_once"},{"optionId":"revise_plan","name":"Revise","kind":"reject_once"}]});
    let request = |value| serde_json::from_value::<RequestPermissionRequest>(value).unwrap();
    assert!(is_codex_plan_review_request(
        AgentType::Codex,
        &request(frame.clone())
    ));
    assert!(!is_codex_plan_review_request(
        AgentType::Grok,
        &request(frame.clone())
    ));
    let mut invalid = frame.clone();
    invalid["toolCall"]["rawInput"]["plan"] = Value::Bool(true);
    assert!(!is_codex_plan_review_request(
        AgentType::Codex,
        &request(invalid)
    ));
    let mut missing = frame;
    missing["options"].as_array_mut().unwrap().pop();
    assert!(!is_codex_plan_review_request(
        AgentType::Codex,
        &request(missing)
    ));
}

#[tokio::test]
async fn grok_followup_preserves_a_prompt_admitted_before_completion() {
    let state = Arc::new(RwLock::new(SessionState::new(
        "contract".into(),
        AgentType::Grok,
        None,
        "owner".into(),
        None,
    )));
    let mut live = CodeBuddyLiveState::default();
    open_grok_agent_turn(&state, &EventEmitter::Noop, "followup".into(), &mut live).await;
    assert!(state.read().await.agent_initiated_turn);
    state.write().await.turn_in_flight = true;
    let perms: PendingPermissions = Arc::new(tokio::sync::Mutex::new(PermissionQueue::default()));
    assert!(
        close_grok_agent_turn(
            &state,
            &EventEmitter::Noop,
            &perms,
            AgentType::Grok,
            "s",
            "end_turn",
            &mut live
        )
        .await
    );
    assert!(state.read().await.turn_in_flight);
    assert!(!state.read().await.agent_initiated_turn);
    open_grok_agent_turn(&state, &EventEmitter::Noop, "other".into(), &mut live).await;
    assert!(live.grok_agent_turn.is_none());
}

#[test]
fn grok_late_frames_cannot_reopen_or_close_another_turn() {
    let chunk = |id: &str| {
        Dispatch::Notification(UntypedMessage::new("session/update",json!({"_meta":{"promptId":id},"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"reply"}}})).unwrap())
    };
    let mut live = CodeBuddyLiveState::default();
    note_grok_turn_prompt_id(&chunk("ended"), &mut live.grok_ended_prompt_ids);
    assert!(grok_agent_turn_opener(&chunk("ended"), AgentType::Grok, &live).is_none());
    assert_eq!(
        grok_agent_turn_opener(&chunk("fresh"), AgentType::Grok, &live).as_deref(),
        Some("fresh")
    );
    assert!(grok_agent_turn_opener(&chunk("fresh"), AgentType::Codex, &live).is_none());
    let late = GrokTurnCompleted {
        prompt_id: Some("ended".into()),
        stop_reason: "end_turn",
    };
    assert!(!grok_turn_completed_ends(Some("fresh"), &late));
}
