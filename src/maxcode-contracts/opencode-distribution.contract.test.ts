import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: verified OpenCode downloads", () => {
  it("keeps the release pin and SHA256 verification on all six platforms", () => {
    const registry = source("src-tauri/src/acp/registry.rs")
    const entry = registry
      .split("AgentType::OpenCode => AcpAgentMeta {")[1]
      ?.split("AgentType::Hermes => AcpAgentMeta {")[0]
    expect(entry).toBeDefined()
    const version = entry?.match(/version: "([^"]+)"/)?.[1]
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    const platforms = [...(entry ?? "").matchAll(/PlatformBinary \{([^}]+)\}/g)]
    expect(
      platforms.map(([, body]) => body.match(/platform: "([^"]+)"/)?.[1]).sort()
    ).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-aarch64",
      "linux-x86_64",
      "windows-aarch64",
      "windows-x86_64",
    ])
    for (const [, body] of platforms) {
      expect(body).toContain(
        `https://github.com/anomalyco/opencode/releases/download/v${version}/`
      )
      expect(body).toMatch(/sha256: Some\(\s*"[a-f0-9]{64}"/)
    }
  })
})
