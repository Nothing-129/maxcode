//! Reviewed Claude 0.84 / Codex 2.0 file-change wire contracts.
use super::*;
use serde_json::json;

fn diff(path: &str, old: Option<&str>, new: &str) -> ToolCallContent {
    serde_json::from_value(json!({
        "type": "diff", "path": path, "oldText": old, "newText": new
    }))
    .unwrap()
}

#[test]
fn maxcode_agent_release_claude_air_restores_omitted_edit_text() {
    let meta = json!({"claudeCode": {"toolName": "Edit"}});
    let input = Some(json!({"file_path": "/repo/a", "replace_all": true}).to_string());
    let content = [diff("/repo/a", Some("before\r\n"), "after\r\n")];
    let recovered =
        synthesize_live_edit_input(AgentType::ClaudeCode, meta.as_object(), &input, &content)
            .unwrap();
    let recovered: serde_json::Value = serde_json::from_str(&recovered).unwrap();
    assert_eq!(recovered["old_string"], "before\r\n");
    assert_eq!(recovered["new_string"], "after\r\n");
    assert_eq!(recovered["replace_all"], true);
    // Once hoisted, the same diff must not also appear in the output channel.
    assert!(serialize_tool_call_content(&content, false).is_none());
}

#[test]
fn maxcode_agent_release_claude_air_keeps_empty_file_creations() {
    let meta = json!({"claudeCode": {"toolName": "Write"}});
    let input = Some(json!({"file_path": "/repo/empty"}).to_string());
    let recovered = synthesize_live_edit_input(
        AgentType::ClaudeCode,
        meta.as_object(),
        &input,
        &[diff("/repo/empty", None, "")],
    )
    .unwrap();
    let recovered: serde_json::Value = serde_json::from_str(&recovered).unwrap();
    assert_eq!(recovered["content"], "");
    assert!(recovered.get("old_string").is_none());
}

#[test]
fn maxcode_agent_release_complete_inputs_and_other_tools_stay_authoritative() {
    let meta = json!({"claudeCode": {"toolName": "Write"}});
    let input = Some(json!({"file_path": "/repo/a", "content": ""}).to_string());
    let content = [diff("/repo/a", None, "different")];
    assert!(
        synthesize_live_edit_input(AgentType::ClaudeCode, meta.as_object(), &input, &content)
            .is_none()
    );
    let input = Some(json!({"file_path": "/repo/a"}).to_string());
    assert!(
        synthesize_live_edit_input(AgentType::Grok, meta.as_object(), &input, &content).is_none()
    );
    let read_meta = json!({"claudeCode": {"toolName": "Read"}});
    assert!(synthesize_live_edit_input(
        AgentType::ClaudeCode,
        read_meta.as_object(),
        &input,
        &content
    )
    .is_none());
    assert!(
        synthesize_live_edit_input(AgentType::ClaudeCode, meta.as_object(), &input, &[]).is_none()
    );
}

#[test]
fn maxcode_agent_release_codex_preserves_all_hunks_in_wire_order() {
    let content = [
        diff("/repo/a", Some("old first\n"), "new first\n"),
        diff("/repo/b", None, "created\n"),
        diff("/repo/a", Some("old second\n"), "new second\n"),
        diff("/repo/a", Some("old third\n"), "new third\n"),
    ];
    let recovered = synthesize_live_edit_input(AgentType::Codex, None, &None, &content).unwrap();
    let recovered: serde_json::Value = serde_json::from_str(&recovered).unwrap();
    let hunks = recovered["changes"]["/repo/a"].as_array().unwrap();
    assert_eq!(hunks.len(), 3);
    assert_eq!(hunks[0]["old_text"], "old first\n");
    assert_eq!(hunks[1]["new_text"], "new second\n");
    assert_eq!(hunks[2]["new_text"], "new third\n");
    assert!(recovered["changes"]["/repo/b"]["diff"]
        .as_str()
        .unwrap()
        .contains("--- /dev/null"));
}

#[test]
fn maxcode_agent_release_air_goals_keep_controls_updates_and_clear() {
    let meta = json!({"jetbrains": {"air": {"version": 1, "goal": {
        "version": 1, "controlMethod": "_session/goal", "actions": ["set", "pause", "resume", "clear"]
    }}}});
    assert!(init_advertises_goal(meta.as_object()));
    assert_eq!(
        goal_advertised_control(meta.as_object()).unwrap().0,
        "_session/goal"
    );
    let update = json!({"jetbrains": {"air": {"version": 1, "goal": {"objective": "finish", "status": "active"}}}});
    assert_eq!(
        session_info_goal_value(true, update.as_object()).unwrap()["objective"],
        "finish"
    );
    let clear = json!({"jetbrains": {"air": {"version": 1, "goal": null}}});
    assert!(session_info_goal_value(true, clear.as_object())
        .unwrap()
        .is_null());
    assert!(session_info_goal_value(false, clear.as_object()).is_none());
    let malformed = json!({"jetbrains": {"air": {"version": "1", "goal": {"version": 1}}}});
    assert!(!init_advertises_goal(malformed.as_object()));
}

#[test]
fn maxcode_agent_release_air_permission_reason_and_durable_options_survive() {
    let meta = json!({"jetbrains": {"air": {"version": 1, "permission": {
        "version": 1, "title": "Run command?", "description": "Needs network", "defaultToNo": true
    }}}});
    let mut call = json!({"toolCallId": "run-1"});
    hoist_request_permission_meta(&mut call, meta.as_object());
    assert_eq!(call["_meta"]["permission"]["description"], "Needs network");
    assert_eq!(call["_meta"]["permission"]["defaultToNo"], true);
    let options =
        normalize_air_tool_meta(AgentType::Codex, meta.as_object().cloned(), None).unwrap();
    assert_eq!(options["permission"]["description"], "Needs network");
    let mut existing = json!({"_meta": {"permission": {"title": "Existing"}}});
    hoist_request_permission_meta(&mut existing, meta.as_object());
    assert_eq!(existing["_meta"]["permission"]["title"], "Existing");
    let other = normalize_air_tool_meta(AgentType::Grok, meta.as_object().cloned(), None).unwrap();
    assert!(other.get("permission").is_none());
}

#[test]
fn maxcode_agent_release_air_claude_identity_and_compaction_keep_legacy_consumers() {
    let meta = json!({"claudeCode": {"toolName": "Agent"}, "jetbrains": {"air": {
        "version": 1, "subagent": true, "commandTitle": "Run tests",
        "skill": {"name": "review", "path": "/repo/SKILL.md"},
        "contextCompaction": {"version": 1}
    }}});
    let projected =
        normalize_air_tool_meta(AgentType::ClaudeCode, meta.as_object().cloned(), None).unwrap();
    assert_eq!(projected["claudeCode"]["subagent"], true);
    assert_eq!(projected["claudeCode"]["title"], "Run tests");
    assert_eq!(projected["claudeCode"]["skill"], "review");
    assert_eq!(projected["claudeCode"]["skillPath"], "/repo/SKILL.md");
    assert_eq!(projected["contextCompaction"]["version"], 1);
    assert!(projected.get("jetbrains").is_some());
}

#[test]
fn maxcode_agent_release_codex_air_subagents_launch_and_settle_on_the_same_capsule() {
    let meta = json!({"jetbrains": {"air": {"version": 1, "subagent": true}}});
    for activity in ["started", "completed", "interrupted", "interacted"] {
        let input = json!({"agentThreadId": "thread-1", "agentPath": "/root/reviewer", "activityKind": activity});
        let projected =
            normalize_air_tool_meta(AgentType::Codex, meta.as_object().cloned(), Some(&input))
                .unwrap();
        match classify_codex_subagent_activity(AgentType::Codex, Some(&projected)) {
            CodexSubagentActivity::Started { thread_id, input } => {
                assert_eq!(activity, "started");
                assert_eq!(thread_id.as_deref(), Some("thread-1"));
                assert_eq!(
                    serde_json::from_str::<serde_json::Value>(&input).unwrap()["subagent_type"],
                    "reviewer"
                );
            }
            CodexSubagentActivity::Terminal { thread_id, kind } => {
                assert_eq!(thread_id, "thread-1");
                assert_eq!(kind, activity);
            }
            CodexSubagentActivity::Other => assert_eq!(activity, "interacted"),
            CodexSubagentActivity::None => panic!("activity lost"),
        }
    }
}

#[test]
fn maxcode_agent_release_codex_plan_review_without_legacy_meta_is_announced() {
    let request: RequestPermissionRequest = serde_json::from_value(json!({
        "sessionId": "s", "toolCall": {
            "toolCallId": "plan-review:plan1", "title": "Implement this plan?",
            "kind": "switch_mode", "status": "pending", "rawInput": {"plan": "Test the change"}
        },
        "options": [
            {"optionId": "implement_plan", "name": "Implement", "kind": "allow_once"},
            {"optionId": "revise_plan", "name": "Revise", "kind": "reject_once"}
        ]
    }))
    .unwrap();
    assert!(is_codex_plan_review_request(AgentType::Codex, &request));
    assert!(!is_codex_plan_review_request(
        AgentType::ClaudeCode,
        &request
    ));
}

#[test]
fn maxcode_agent_release_claude_sparse_updates_keep_identity_without_replaying_output() {
    let mut cache = AirToolMetaCache::default();
    let initial = json!({"claudeCode": {"toolName": "Write", "parentToolUseId": "agent-1"},
        "jetbrains": {"air": {"version": 1, "subagent": true, "contextCompaction": {"version": 1}}},
        "terminal_output_delta": {"data": "first output", "terminal_id": "write-1"}});
    cache.normalize(
        AgentType::ClaudeCode,
        "write-1",
        initial.as_object().cloned(),
        None,
    );
    // ChangedMetaFilter removes the repeated toolName and AIR version.
    let sparse = json!({"jetbrains": {"air": {"commandTitle": "new heading"}}});
    let restored = cache
        .normalize(
            AgentType::ClaudeCode,
            "write-1",
            sparse.as_object().cloned(),
            None,
        )
        .unwrap();
    assert_eq!(restored["claudeCode"]["toolName"], "Write");
    assert_eq!(restored["claudeCode"]["parentToolUseId"], "agent-1");
    assert_eq!(restored["claudeCode"]["title"], "new heading");
    assert_eq!(restored["contextCompaction"]["version"], 1);
    assert!(restored.get("terminal_output_delta").is_none());
    let input = Some(json!({"file_path": "/repo/a"}).to_string());
    assert!(synthesize_live_edit_input(
        AgentType::ClaudeCode,
        Some(&restored),
        &input,
        &[diff("/repo/a", None, "content")]
    )
    .is_some());
    assert!(cache
        .normalize(AgentType::ClaudeCode, "different-call", None, None)
        .is_none());
}
