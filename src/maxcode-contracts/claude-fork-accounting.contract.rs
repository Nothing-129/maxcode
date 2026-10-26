use super::*;
use std::io::Write;

#[test]
fn fork_inherited_context_is_excluded_without_changing_normal_subagents() {
    let inherited = serde_json::json!({"type":"assistant", "timestamp":"2026-10-20T01:00:00Z",
        "message":{"id":"parent", "usage":{"input_tokens":1000,"output_tokens":10},
        "content":[{"type":"tool_use","id":"parent-call","name":"Agent","input":{}}]}});
    let own = serde_json::json!({"type":"assistant", "timestamp":"2026-10-20T02:00:01Z",
        "message":{"id":"child", "usage":{"input_tokens":20,"output_tokens":2},
        "content":[{"type":"tool_use","id":"child-call","name":"Read","input":{}}]}});
    for is_fork in [false, true] {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "{}", inherited).unwrap();
        if is_fork {
            writeln!(file, "{}", serde_json::json!({"type":"user", "timestamp":"2026-10-20T02:00:00Z",
                "message":{"content":[{"type":"text","text":"<fork-boilerplate>inherited context</fork-boilerplate>"},
                {"type":"tool_result","tool_use_id":"parent-call","content":"Fork started — processing in background"}]}})).unwrap();
        }
        writeln!(file, "{}", own).unwrap();
        let (calls, usage, started) = parse_subagent_tool_calls(&file.path().to_path_buf());
        assert_eq!(calls.len(), if is_fork { 1 } else { 2 });
        assert_eq!(calls.last().unwrap().tool_name, "Read");
        assert_eq!(usage.unwrap().input_tokens, if is_fork { 20 } else { 1020 });
        assert_eq!(
            started.unwrap().to_rfc3339(),
            if is_fork {
                "2026-10-20T02:00:00+00:00"
            } else {
                "2026-10-20T01:00:00+00:00"
            }
        );
    }
}
