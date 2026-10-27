use super::*;
use serde_json::json;
use std::io::Write;

/// What Claude Code 2.1.310 writes for one API message that called the
/// `advisor` server tool (recorded against a fake API, ids shortened): one
/// assistant record per content block, the call and its result included,
/// all under the same `message.id`.
fn advisor_transcript(result_content: serde_json::Value) -> Vec<String> {
    let assistant = |uuid: &str, at: &str, block: serde_json::Value| {
        json!({
            "type": "assistant", "timestamp": at, "uuid": uuid,
            "cwd": "/Users/test/proj", "sessionId": "sess-advisor",
            "message": {
                "id": "msg_adv", "role": "assistant", "model": "claude-opus-5-5",
                "content": [block],
                "usage": {"input_tokens": 1000, "output_tokens": 7,
                    "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            },
        })
        .to_string()
    };
    vec![
        json!({
            "type": "user", "timestamp": "2026-10-26T14:20:24.379Z", "uuid": "u1",
            "cwd": "/Users/test/proj", "sessionId": "sess-advisor",
            "message": {"role": "user", "content": "check my plan with the advisor"},
        })
        .to_string(),
        assistant(
            "a1",
            "2026-10-26T14:20:24.420Z",
            json!({"type": "text", "text": "let me ask the advisor"}),
        ),
        assistant(
            "a2",
            "2026-10-26T14:20:24.421Z",
            json!({"type": "server_tool_use", "id": "srvtoolu_adv", "name": "advisor", "input": {}}),
        ),
        assistant(
            "a3",
            "2026-10-26T14:20:24.422Z",
            json!({"type": "advisor_tool_result", "tool_use_id": "srvtoolu_adv",
                    "content": result_content}),
        ),
        assistant(
            "a4",
            "2026-10-26T14:20:24.423Z",
            json!({"type": "text", "text": "advisor consulted; final answer"}),
        ),
    ]
}

#[test]
fn an_advisor_call_reads_its_result_from_the_assistant_side() {
    let dir = tempfile::tempdir().unwrap();
    let proj = dir.path().join("-Users-test-proj");
    std::fs::create_dir_all(&proj).unwrap();
    let lines = advisor_transcript(json!({
        "type": "advisor_result",
        "text": "ADVICE: check the edge cases first.",
        "stop_reason": "end_turn",
    }));
    std::fs::write(proj.join("sess-advisor.jsonl"), lines.join("\n") + "\n").unwrap();

    let parser = ClaudeParser::with_base_dir(dir.path().to_path_buf());
    let detail = parser.get_conversation("sess-advisor").unwrap();
    let turn = detail
        .turns
        .iter()
        .find(|turn| {
            turn.blocks.iter().any(
                |b| matches!(b, ContentBlock::ToolUse { tool_name, .. } if tool_name == "advisor"),
            )
        })
        .expect("the advisor call is a turn's block");
    assert!(
        turn.blocks.iter().any(|b| matches!(
            b,
            ContentBlock::ToolResult {
                tool_use_id: Some(id),
                output_preview: Some(text),
                is_error: false,
                ..
            } if id == "srvtoolu_adv" && text == "ADVICE: check the edge cases first."
        )),
        "the result sits with its call, as the live card has it: {:?}",
        turn.blocks
    );
    // The result's own record leaves no turn behind once it is moved.
    assert!(
        detail.turns.iter().all(|turn| !turn
            .blocks
            .iter()
            .all(|b| matches!(b, ContentBlock::ToolResult { .. }))),
        "{:?}",
        detail.turns
    );
}

#[test]
fn advisor_results_read_as_the_live_adapter_reports_them() {
    let read = |content: serde_json::Value| {
        advisor_tool_result(&json!({
            "type": "advisor_tool_result", "tool_use_id": "srvtoolu_adv", "content": content,
        }))
        .map(|r| (r.tool_use_id, r.text, r.is_error))
    };
    assert_eq!(
        read(json!({"type": "advisor_result", "text": "do X", "stop_reason": "end_turn"})),
        Some(("srvtoolu_adv".to_string(), Some("do X".to_string()), false))
    );
    // Encrypted advice is never shown, as the adapter never shows it.
    assert_eq!(
        read(json!({
            "type": "advisor_redacted_result",
            "encrypted_content": "Q0lQSEVS",
            "stop_reason": "end_turn",
        })),
        Some((
            "srvtoolu_adv".to_string(),
            Some("Advisor guidance applied server-side.".to_string()),
            false
        ))
    );
    assert_eq!(
        read(json!({"type": "advisor_tool_result_error", "error_code": "overloaded"})),
        Some((
            "srvtoolu_adv".to_string(),
            Some("Advisor error: overloaded".to_string()),
            true
        ))
    );
    assert_eq!(
        read(json!({"type": "advisor_future_kind"})),
        Some(("srvtoolu_adv".to_string(), None, false))
    );
    assert!(advisor_tool_result(&json!({"type": "advisor_tool_result"})).is_none());
}

#[test]
fn a_subagent_advisor_call_gets_its_result() {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    for line in advisor_transcript(json!({"type": "advisor_tool_result_error",
            "error_code": "overloaded"}))
    .into_iter()
    .skip(1)
    {
        writeln!(file, "{line}").unwrap();
    }
    let (calls, _, _) = parse_subagent_tool_calls(&file.path().to_path_buf());
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert_eq!(calls[0].tool_name, "advisor");
    assert_eq!(
        calls[0].output_preview.as_deref(),
        Some("Advisor error: overloaded")
    );
    assert!(calls[0].is_error);
}
