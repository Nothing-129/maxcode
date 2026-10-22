use super::*;

#[test]
fn agents_context_without_workspace_suffix_stays_hidden() {
    for header in [
        "# AGENTS.md instructions",
        r"# AGENTS.md instructions for C:\Users\Administrator\project",
        "# AGENTS.md instructions for /tmp/project",
    ] {
        for newline in ["\n", "\r\n"] {
            for canonical in [false, true] {
                let context = format!(
                    "{header}{newline}{newline}<INSTRUCTIONS>{newline}以后请全部用中文回复我{newline}</INSTRUCTIONS>{newline}<environment_context>{newline}<cwd>C:\\Users\\Administrator\\project</cwd>{newline}<shell>powershell</shell>{newline}</environment_context>"
                );
                let mut records = vec![serde_json::json!({
                    "type": "session_meta",
                    "payload": {"id": "agents-context", "cwd": "/tmp/project"}
                })];
                for text in [context.as_str(), "1"] {
                    records.push(serde_json::json!({
                        "type": "response_item",
                        "payload": {"type": "message", "role": "user",
                            "content": [{"type": "input_text", "text": text}]}
                    }));
                }
                if canonical {
                    records.push(serde_json::json!({
                        "type": "event_msg",
                        "payload": {"type": "user_message", "message": "1"}
                    }));
                }
                let content = records
                    .into_iter()
                    .map(|mut record| {
                        record["timestamp"] = serde_json::json!("2026-10-22T10:00:00Z");
                        record.to_string() + "\n"
                    })
                    .collect::<String>();
                let temp = tempfile::tempdir().unwrap();
                let path = temp.path().join("rollout.jsonl");
                fs::write(&path, content).unwrap();
                let parser = CodexParser::new();
                let detail = parser
                    .parse_conversation_detail(&path, "agents-context")
                    .unwrap();
                assert_eq!(detail.turns.len(), 1, "{header}, {canonical}, {newline:?}");
                assert!(
                    matches!(&detail.turns[0].blocks[0], ContentBlock::Text { text } if text == "1")
                );
                let summary = parser.parse_jsonl_summary(&path).unwrap().unwrap();
                assert_eq!(summary.message_count, 1);
                assert_eq!(summary.title.as_deref(), Some("1"));
            }
        }
    }
}

#[test]
fn ordinary_agents_questions_are_preserved() {
    for text in [
        "解释 # AGENTS.md instructions 的含义",
        "# AGENTS.md instructions\n如何配置这个文件？",
        "# AGENTS.md instructions\n<INSTRUCTIONS>unterminated",
    ] {
        assert!(is_promotable_user_text(text));
        assert!(extract_codex_title_candidate(text, true).is_some());
    }
}
