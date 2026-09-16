import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

const registry = source("src-tauri/src/acp/registry.rs")

function agentEntry(agent: string, next: string): string {
  const start = registry.indexOf(`AgentType::${agent} => AcpAgentMeta {`)
  const end = registry.indexOf(`AgentType::${next} => AcpAgentMeta {`, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return registry.slice(start, end)
}

describe("MaxCode contract: reviewed built-in agent version catalog", () => {
  it.each([
    ["Gemini", "OpenClaw", "0.59.0", "@google/gemini-cli@0.59.0"],
    ["OpenClaw", "Cline", "2026.9.3", "openclaw@2026.9.3"],
    ["Hermes", "CodeBuddy", "0.21.1", "hermes-agent@0.21.1"],
    ["CodeBuddy", "KimiCode", "2.149.0", "@tencent-ai/codebuddy-code@2.149.0"],
    ["KimiCode", "Pi", "0.42.0", "@moonshot-ai/kimi-code@0.42.0"],
    ["Grok", "Cursor", "1.0.30", "@xai-official/grok@1.0.30"],
    ["Qoder", "Antigravity", "1.1.49", "@qoder-ai/qodercli@1.1.49"],
  ])(
    "pins %s before %s at the reviewed release",
    (agent, next, version, pkg) => {
      const entry = agentEntry(agent, next)
      expect(entry).toContain(`version: "${version}"`)
      expect(entry).toContain(`package: "${pkg}"`)
    }
  )

  it("pins OpenCode 1.18.30 with independently computed hashes on all platforms", () => {
    const entry = agentEntry("OpenCode", "Hermes")
    expect(entry).toContain('version: "1.18.30"')
    expect(entry).toContain("official GitHub Release assets for v1.18.30")
    for (const hash of [
      "a5e43d6887386efc7d68ce49ae28e3bbdfdee3dfd1d7169b612c3ce67e53b1e8",
      "7453007e58ff122401438d95ccb24334874b5908dcaee77883f96c23395d5710",
      "4111a55c2a02c0fac314bd51e9a2330280e6d29d2b85b9554fff6d62612566ed",
      "55007246858165496ff85ba1c2b648f7421e8e2013bf4189a680c9ff8e699d17",
      "35d6ff7d80aff5ade71ac06fc32dd89357b5b0bac050fc6db41ecf0929cea560",
      "c8c0e0d05ac3dac544a0edfad8de9eb244bf46c6c7a131c38619d40fcf31bd1f",
    ]) {
      expect(entry).toContain(hash)
    }
  })
})
