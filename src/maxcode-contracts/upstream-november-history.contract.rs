use super::*;
use serde_json::json;

#[test]
fn v4_tool_failure_preserves_output_and_cache_writes() {
    let event = |kind: &str, seq, data| {
        json!({"type":kind,"seq":seq,"time":1000+seq,"data":data}).to_string()
    };
    let log = [
        json!({"type":"session","version":4,"id":"november","cwd":"/w","createdAt":1000}).to_string(),
        event("turn/start",1,json!({"turn":1})),
        event("tool/result",2,json!({"turn":1,"message":{"role":"tool","toolCallId":"c","content":[{"type":"text","text":"permission denied"}],"isError":true}})),
        event("assistant/message",3,json!({"turn":1,"message":{"role":"assistant","content":[{"type":"text","text":"failed"}]},"usage":{"inputTokens":2,"outputTokens":1,"cacheWriteTokens":7}})),
        event("turn/end",4,json!({"turn":1})),
    ].join("\n");
    let parsed = parse_session_events(&log, None);
    assert!(parsed.turns.iter().flat_map(|t| &t.blocks).any(|b| matches!(b, ContentBlock::ToolResult{is_error:true,output_preview:Some(text),..} if text.contains("permission denied"))));
    assert_eq!(
        parsed
            .turns
            .last()
            .unwrap()
            .usage
            .as_ref()
            .unwrap()
            .cache_creation_input_tokens,
        7
    );
}
