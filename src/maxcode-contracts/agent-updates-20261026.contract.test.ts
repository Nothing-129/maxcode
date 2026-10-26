import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("reviewed October 26 agent updates", () => {
  it("keeps the seven-agent catalog and reviewed pins", () => {
    const registry = source("src-tauri/src/acp/registry.rs")
    for (const pkg of [
      "claude-agent-acp@0.94.0",
      "codex-acp@2.2.2",
      "grok@1.0.62",
      "pi-acp@0.0.34",
      "deepseek-acp@0.9.0",
      "zcode-acp-server@0.76.2",
      "agy-acp-server-1.4.1",
    ])
      expect(registry).toContain(pkg)
    expect(registry).toContain(
      "maxcode_maintained_catalog_preserves_legacy_types"
    )
  })

  it("preserves remote sessions through both phases of MaxCode's grouped idle eviction", () => {
    const connections = source("src/contexts/acp-connections-context.tsx")
    expect(connections).toContain("if (conn.remoteControl) continue")
    expect(connections.match(/conn\.remoteControl != null \|\|/g)).toHaveLength(
      2
    )
    expect(source("src-tauri/src/acp/manager.rs")).toContain(
      "state.remote_control.is_some()"
    )
    const shell = source("src/components/chat/conversation-shell.tsx")
    expect(shell).toContain("<RemoteControlStrip")
    expect(shell).not.toContain("<AsyncTaskStrip")
  })

  it("registers executable fork-accounting coverage and invalidates old facts", () => {
    expect(source("src-tauri/src/parsers/claude.rs")).toContain(
      "mod maxcode_claude_fork_accounting_contract;"
    )
    expect(source("src-tauri/src/commands/token_usage.rs")).toContain(
      '"maxcode-4-claude-fork"'
    )
  })
})
