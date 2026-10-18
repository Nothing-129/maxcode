import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("Codex native steering integration", () => {
  it("registers executable adapter lifecycle contracts", () => {
    const adapter = source("src-tauri/src/acp/codex_steering.rs")
    expect(adapter).toContain("codex-native-steering.contract.rs")
    expect(adapter).toContain("mod contract;")
    const connection = source("src-tauri/src/acp/connection.rs")
    expect(connection).toContain(
      "super::codex_steering::prepare(path, scratch)"
    )
    expect(connection).toContain(
      "super::codex_steering::advertises_safe_steering(meta, agent_info)"
    )
  })
})
