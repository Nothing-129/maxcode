use super::*;

#[test]
fn maxcode_codex_fork_retains_companion_without_changing_deepseek() {
    let servers = vec![McpServer::Stdio(
        agent_client_protocol::schema::v1::McpServerStdio::new("codeg-mcp", "/tmp/codeg-mcp"),
    )];
    for agent in [AgentType::Codex, AgentType::ClaudeCode, AgentType::DeepSeek] {
        let request = build_fork_request(
            &SessionId::new("parent"), agent, "/workspace", &servers, true, None,
        );
        let wire = serde_json::to_value(request).unwrap();
        assert_eq!(wire["sessionId"], "parent");
        if agent == AgentType::DeepSeek {
            assert!(wire.get("mcpServers").is_none());
        } else {
            assert_eq!(wire["mcpServers"][0]["name"], "codeg-mcp");
        }
        if agent == AgentType::Codex {
            assert!(wire.get("_meta").is_none());
        }
    }
}
