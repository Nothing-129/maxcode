use super::*;

#[test]
fn science_status_catalog_preserves_legacy_rows_and_covers_every_maintained_skill_agent() {
    let expected = [
        AgentType::ClaudeCode,
        AgentType::Codex,
        AgentType::OpenCode,
        AgentType::Gemini,
        AgentType::OpenClaw,
        AgentType::Cline,
        AgentType::Hermes,
        AgentType::CodeBuddy,
        AgentType::KimiCode,
        AgentType::Pi,
        AgentType::Grok,
        AgentType::DeepSeek,
        AgentType::Antigravity,
        AgentType::Zcode,
    ];
    let actual: Vec<_> = supported_agents()
        .into_iter()
        .filter(|agent| !agent.is_custom())
        .collect();
    assert_eq!(actual, expected);

    // All visible MaxCode agents that declare a skill store must have a status
    // row. Historical agents remain readable, while upstream-only new agent
    // columns do not enter this product through a science status snapshot.
    for agent in crate::acp::registry::builtin_acp_agents()
        .into_iter()
        .filter(|agent| crate::acp::registry::is_maintained_agent(*agent))
        .filter(|agent| skill_storage_spec(*agent).is_some())
    {
        assert!(actual.contains(&agent), "missing maintained {agent:?}");
    }
    assert!(!actual.contains(&AgentType::Cursor));
    assert!(!actual.contains(&AgentType::Qoder));
}
