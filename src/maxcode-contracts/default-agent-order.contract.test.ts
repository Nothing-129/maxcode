import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: initial agent order", () => {
  it("initializes the built-ins in the requested settings order", () => {
    const registry = source("src-tauri/src/acp/registry.rs")
    const builtins = registry
      .split("pub fn builtin_acp_agents()")[1]
      .split("pub fn all_acp_agents()")[0]
    expect(
      [...builtins.matchAll(/AgentType::(\w+)/g)].map((m) => m[1])
    ).toEqual([
      "Codex",
      "Grok",
      "DeepSeek",
      "Pi",
      "Antigravity",
      "ClaudeCode",
      "Gemini",
      "OpenClaw",
      "OpenCode",
      "Cline",
      "Hermes",
      "CodeBuddy",
      "KimiCode",
      "Cursor",
      "Qoder",
    ])
    expect(registry).toContain(
      "let mut agents = builtin_acp_agents();\n    agents.extend(crate::acp::custom_registry::all());"
    )
    const commands = source("src-tauri/src/commands/acp.rs")
    expect(commands).toContain("default_sort_order: idx as i32")
    expect(commands).toContain(
      "setting.map(|m| m.sort_order).unwrap_or(idx as i32)"
    )
  })

  it("keeps existing user ordering when initializing defaults again", () => {
    const service = source("src-tauri/src/db/service/agent_setting_service.rs")
    const existing = service
      .split("if let Some(model) = existing {")[1]
      .split("let now = Utc::now();")[0]
    expect(existing).toContain("continue;")
    expect(existing).not.toContain("sort_order =")
    expect(service).toContain("sort_order: Set(default.default_sort_order)")
  })
})
