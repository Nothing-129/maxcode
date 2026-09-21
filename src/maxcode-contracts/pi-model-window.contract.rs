//! Independent MaxCode contract: Pi capacity is provider-aware, never a cross-provider maximum.
use super::*;
use serde_json::json;

#[test]
fn maxcode_pi_window_uses_final_definition_and_override_layers() {
    let raw = json!({"providers": {
        "proxy": {"models": [
            {"id": "shared", "contextWindow": 900000},
            {"id": "shared", "contextWindow": 64000},
            {"id": "gpt-5.5"}
        ]},
        "other": {"models": [{"id": "shared", "contextWindow": 1000000}]}
    }})
    .to_string();
    assert_eq!(
        pi_declared_context_window_from(&raw, Some("proxy"), "shared"),
        Some(64000)
    );
    assert_eq!(pi_declared_context_window_from(&raw, None, "shared"), None);
    assert_eq!(
        pi_declared_context_window_from(&raw, Some("missing"), "shared"),
        None
    );
    assert_eq!(
        pi_declared_context_window_from(&raw, Some("proxy"), "gpt-5.5"),
        Some(128000)
    );
    for (override_value, expected) in [
        (json!(32000), Some(32000)),
        (json!(0), None),
        (json!("invalid"), None),
    ] {
        let raw = json!({"providers":{"proxy":{
            "models":[{"id":"shared","contextWindow":64000}],
            "modelOverrides":{"shared":{"contextWindow":override_value}}
        }}})
        .to_string();
        assert_eq!(
            pi_declared_context_window_from(&raw, Some("proxy"), "shared"),
            expected
        );
    }
}

#[test]
fn maxcode_pi_provider_switch_and_missing_provider_never_reuse_previous_pair() {
    let root = tempfile::tempdir().unwrap();
    let sessions = root.path().join("sessions");
    fs::create_dir_all(&sessions).unwrap();
    let path = sessions.join("2026-09-20_contract.jsonl");
    fs::write(
        root.path().join("models.json"),
        json!({"providers": {
            "first": {"models":[{"id":"shared","contextWindow":900000}]},
            "last": {"models":[{"id":"shared","contextWindow":64000}]}
        }})
        .to_string(),
    )
    .unwrap();
    let mut records = vec![
        json!({"type":"session","version":3,"id":"contract","timestamp":"2026-09-20T00:00:00Z","cwd":"/project"}),
        json!({"type":"model_change","id":"a","parentId":null,"provider":"first","modelId":"shared"}),
        json!({"type":"message","id":"b","parentId":"a","timestamp":"2026-09-20T00:00:01Z","message":{"role":"user","content":"hello"}}),
        json!({"type":"message","id":"c","parentId":"b","timestamp":"2026-09-20T00:00:02Z","message":{"role":"assistant","provider":"last","model":"shared","content":[{"type":"text","text":"done"}],"usage":{"input":100,"output":20,"totalTokens":120}}}),
    ];
    let write = |records: &[Value]| {
        fs::write(
            &path,
            records
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap()
    };
    write(&records);
    let parser = PiParser::with_base_dir(sessions);
    let detail = parser.get_conversation("contract").unwrap();
    assert_eq!(detail.summary.model.as_deref(), Some("shared"));
    assert_eq!(
        detail.session_stats.unwrap().context_window_max_tokens,
        Some(64000)
    );
    records.push(json!({"type":"model_change","id":"d","parentId":"c","modelId":"shared"}));
    write(&records);
    assert_eq!(
        parser
            .get_conversation("contract")
            .unwrap()
            .session_stats
            .unwrap()
            .context_window_max_tokens,
        None
    );
    fs::write(root.path().join("models.json"), "broken").unwrap();
    assert_eq!(
        pi_declared_context_window(root.path(), Some("last"), Some("shared")),
        None
    );
}
