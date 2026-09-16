import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(path, "utf8")

describe("official agent runtime updates", () => {
  it("uses official versions and refreshes vendor runtimes without an adapter release", () => {
    const releases = source("src-tauri/src/commands/agent_updates.rs")
    expect(releases).toContain('"https://registry.npmjs.org"')
    expect(releases).not.toContain("AGENT_NPM_REGISTRY")
    const worker = source("src-tauri/src/commands/agent_auto_updates.rs")
    for (const name of [
      "@openai/codex",
      "@anthropic-ai/claude-code",
      "@earendil-works/pi-coding-agent",
    ])
      expect(worker).toContain(name)
    expect(worker).toContain("official_npm_version(package).await")
    expect(worker).toContain("!needs_update && runtime_is_current")
    expect(worker).toContain("installed.runtime_version.as_deref()")
    expect(worker).toContain(
      "prepare_vendor_runtime(agent, &prefix, npm, &version)"
    )
    expect(worker).toContain("--registry={OFFICIAL_NPM_REGISTRY}")
    expect(worker).toContain('prefix.join("runtime")')
  })

  it("launches the validated managed runtime while preserving explicit custom paths", () => {
    const connection = source("src-tauri/src/acp/connection.rs")
    expect(connection).toContain(
      "agent_auto_updates::managed_runtime(agent_type)"
    )
    expect(connection).toContain(
      "agent_auto_updates::managed_runtime(AgentType::Pi)"
    )
    const worker = source("src-tauri/src/commands/agent_auto_updates.rs")
    for (const name of [
      "CODEX_PATH",
      "CLAUDE_CODE_EXECUTABLE",
      "PI_ACP_PI_COMMAND",
    ])
      expect(worker).toContain(name)
    expect(worker).toContain("official version cannot be managed automatically")
    expect(worker).toContain(
      "vendor_runtime_install_uses_official_exact_version_and_rejects_wrong_binary"
    )
  })
})
