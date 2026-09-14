import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: DeepSeek 0.9.0 model catalog editor", () => {
  it("pins deepseek-acp 0.9.0 without dropping v3 history recovery", () => {
    const registry = source("src-tauri/src/acp/registry.rs")
    expect(registry).toContain('package: "deepseek-acp@0.9.0"')
    expect(registry).toContain('version: "0.9.0"')
    expect(
      source("src/maxcode-contracts/deepseek-versioned-history.contract.rs")
    ).toContain("fn v3_history_survives_an_incomplete_appended_frame()")
  })

  it("keeps the existing key/url panel and adds the catalog editor beside it", () => {
    const settings = source("src/components/settings/acp-agent-settings.tsx")
    expect(settings).toContain("<DeepSeekConfigPanel")
    expect(settings).toContain("<DeepSeekModelListEditor")
    expect(
      source("src/components/settings/deepseek-config-panel.tsx")
    ).toContain("DEEPSEEK_PANEL_ENV_KEYS")
  })

  it("still reads assistant/chunk for first-token timing on older logs", () => {
    const parser = source("src-tauri/src/parsers/deepseek.rs")
    expect(parser).toContain('event_type == "assistant/chunk"')
    expect(parser).toContain("is_deepseek_token_delta")
  })
})
