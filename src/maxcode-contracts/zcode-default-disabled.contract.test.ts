import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

const service = source("src-tauri/src/db/service/agent_setting_service.rs")
const commands = source("src-tauri/src/commands/acp.rs")

describe("MaxCode contract: ZCode defaults to disabled", () => {
  it("defaults new settings, status and selectors to disabled", () => {
    const defaults = service
      .split("fn default_enabled(agent_type: AgentType) -> bool {")[1]
      .split("pub async fn ensure_defaults")[0]
    expect(defaults).not.toContain("AgentType::Zcode")
    for (const agent of [
      "ClaudeCode",
      "Codex",
      "Grok",
      "Pi",
      "DeepSeek",
      "Antigravity",
    ]) {
      expect(defaults).toContain(`AgentType::${agent}`)
    }
    expect(service).toContain(
      "enabled: Set(default_enabled(default.agent_type))"
    )
    expect(
      commands.match(
        /\.unwrap_or_else\(\|\| agent_setting_service::default_enabled\(agent_type\)\)/g
      )
    ).toHaveLength(4)
    expect(commands).not.toContain(
      "enabled: setting.map(|m| m.enabled).unwrap_or(true)"
    )
  })

  it("preserves saved enable and disable choices when defaults are ensured", () => {
    const existing = service
      .split("if let Some(model) = existing {")[1]
      .split("let now = Utc::now();")[0]
    expect(existing).toContain("continue;")
    expect(existing).not.toContain("enabled =")
  })
})
