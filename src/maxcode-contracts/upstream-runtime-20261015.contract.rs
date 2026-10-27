//! Reviewed runtime upgrades must retain MaxCode's agent, queue and selector gates.
use super::*;
use serde_json::json;

#[test]
fn reviewed_pins_leave_unreviewed_agents_and_runtime_gates_alone() {
    use crate::acp::registry::{get_agent_meta, AgentDistribution};
    for (agent, pin, node) in [
        (AgentType::ClaudeCode, "0.97.0", "22.0.0"),
        (AgentType::Codex, "2.2.2", "20.3.0"),
        (AgentType::Grok, "1.0.62", "20.0.0"),
        (AgentType::Pi, "0.0.34", "22.0.0"),
        (AgentType::DeepSeek, "0.9.0", "22.0.0"),
        (AgentType::Zcode, "0.76.2", "22.0.0"),
    ] {
        let AgentDistribution::Npx {
            version,
            node_required,
            ..
        } = get_agent_meta(agent).distribution
        else {
            panic!("expected npm distribution")
        };
        assert_eq!(version, pin, "{agent}");
        assert_eq!(node_required, Some(node), "{agent}");
    }
    let peer = agent_client_protocol::schema::v1::Implementation::new("codex-acp", "2.2.2");
    let advertised = json!({"steering":{"supported":true}});
    assert!(!synthesize_native_steering(
        AgentType::Codex,
        advertised.as_object(),
        Some(&peer)
    ));
    // MaxCode's reviewed private copy proves the idle lifecycle separately;
    // the unmodified npm adapter above must remain on pull feedback.
    let safe = json!({"steering":{"supported":true,"maxcodePromptRequired":1}});
    assert!(synthesize_native_steering(
        AgentType::Codex,
        safe.as_object(),
        Some(&peer)
    ));
    let caps = serde_json::from_value(json!({"sessionCapabilities":{"fork":{}}})).unwrap();
    assert!(!supports_session_fork(AgentType::Zcode, &caps));
}

#[test]
fn antigravity_only_replays_legacy_models_the_same_session_still_offers() {
    let option: SessionConfigOption = serde_json::from_value(json!({
        "id":"model", "name":"Model", "type":"select", "category":"model",
        "currentValue":"gemini-3.8-flash", "options":[
            {"value":"gemini-3.8-flash", "name":"Flash"}
        ]
    }))
    .unwrap();
    let models = json!({"availableModels":[{"modelId":"gemini-3.1-pro-high"}]});
    assert!(session_model_list_offers(
        AgentType::Antigravity,
        &option,
        "gemini-3.1-pro-high",
        Some(&models)
    ));
    assert!(!session_model_list_offers(
        AgentType::Antigravity,
        &option,
        "retired",
        Some(&models)
    ));
    assert!(!session_model_list_offers(
        AgentType::Antigravity,
        &option,
        "gemini-3.1-pro-high",
        None
    ));
    for agent in [AgentType::ClaudeCode, AgentType::Codex, AgentType::Zcode] {
        assert!(!session_model_list_offers(
            agent,
            &option,
            "gemini-3.1-pro-high",
            Some(&models)
        ));
    }
}

#[test]
fn relocated_claude_history_uses_the_launch_env_without_changing_global_env() {
    use crate::parsers::{build_agent_parser, AgentEnv};
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("projects").join("project");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("contract-session.jsonl"), concat!(
        "{\"type\":\"user\",\"uuid\":\"u1\",\"timestamp\":\"2026-10-15T01:00:00Z\",\"cwd\":\"/tmp/project\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"preserve my prompt\"}]}}\n",
        "{\"type\":\"assistant\",\"uuid\":\"a1\",\"timestamp\":\"2026-10-15T01:00:01Z\",\"message\":{\"role\":\"assistant\",\"model\":\"claude-sonnet-5-5\",\"content\":[{\"type\":\"text\",\"text\":\"preserved reply\"}]}}\n"
    )).unwrap();
    let inherited = std::env::var_os("CLAUDE_CONFIG_DIR");
    let env = AgentEnv::from_overrides(BTreeMap::from([(
        "CLAUDE_CONFIG_DIR".into(),
        dir.path().to_string_lossy().into_owned(),
    )]));
    let detail = build_agent_parser(AgentType::ClaudeCode, &env)
        .get_conversation("contract-session")
        .unwrap();
    let rendered = serde_json::to_string(&detail.turns).unwrap();
    assert!(rendered.contains("preserve my prompt"));
    assert!(rendered.contains("preserved reply"));
    assert_eq!(std::env::var_os("CLAUDE_CONFIG_DIR"), inherited);
}

#[test]
fn cli_input_aliases_keep_the_command_and_explicit_user_fields() {
    use crate::parsers::claude::canonical_file_tool_input;
    let bash = json!({"command":"pnpm test", "command_description":"Run tests", "timeout_ms":1000});
    let fixed = canonical_file_tool_input("Bash", &bash).unwrap();
    assert_eq!(fixed["command"], "pnpm test");
    assert_eq!(fixed["description"], "Run tests");
    assert_eq!(fixed["timeout"], 1000);
    let explicit = json!({"command":"pnpm test", "description":"User description", "command_description":"Alias"});
    assert_eq!(
        canonical_file_tool_input("Bash", &explicit).unwrap()["description"],
        "User description"
    );
}

#[tokio::test]
async fn disconnect_cancels_startup_without_consuming_queued_prompts() {
    let token = CancellationToken::new();
    let (tx, mut rx) = mpsc::channel(1);
    tx.send("queued prompt").await.unwrap();
    token.cancel();
    let result = unless_cancelled(&token, std::future::pending::<()>()).await;
    assert!(result
        .unwrap_err()
        .to_string()
        .contains(HANDSHAKE_CANCELLED_SENTINEL));
    assert_eq!(rx.recv().await, Some("queued prompt"));
}

#[test]
fn navigation_outline_retains_failed_file_write_ids_across_subturns() {
    let turns: Vec<crate::models::message::MessageTurn> = serde_json::from_value(json!([
        {"id":"call","role":"assistant","timestamp":"2026-10-15T01:00:00Z","blocks":[
            {"type":"tool_use","tool_use_id":"write-1","tool_name":"Write","input_preview":"{\"file_path\":\"/repo/secret.txt\",\"content\":\"replacement\"}"}
        ]},
        {"id":"result","role":"assistant","timestamp":"2026-10-15T01:00:01Z","blocks":[
            {"type":"tool_result","tool_use_id":"write-1","is_error":true,"output_preview":"private failure details"}
        ]}
    ])).unwrap();
    let outline = crate::commands::turn_window::nav_outline_turns(&turns);
    assert_eq!(outline.len(), 2);
    assert!(
        matches!(&outline[1].blocks[0], crate::models::ContentBlock::ToolResult {
        tool_use_id: Some(id), is_error: true, output_preview: None, images, ..
    } if id == "write-1" && images.is_empty())
    );
    assert!(!serde_json::to_string(&outline)
        .unwrap()
        .contains("private failure details"));
}
