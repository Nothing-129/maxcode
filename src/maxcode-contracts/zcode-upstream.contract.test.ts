import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8")

describe("MaxCode contract: upstream ZCode integration", () => {
  it("runs the behavioral mode and cancellation contracts in the Rust suite", () => {
    const connection = read("src-tauri/src/acp/connection.rs")
    expect(connection).toContain(
      '#[path = "../../../src/maxcode-contracts/zcode-upstream.contract.rs"]'
    )
    const contract = read("src/maxcode-contracts/zcode-upstream.contract.rs")
    for (const name of [
      "zcode_confirms_build_before_first_prompt",
      "zcode_plan_updates_native_mode_before_confirming_config",
      "zcode_does_not_prompt_after_failed_mode_confirmation",
      "zcode_cancelled_handshake_stops_mode_confirmation_before_config_or_prompt",
      "zcode_does_not_replay_the_mode_its_gate_applied",
      "zcode_records_history_without_enabling_native_parser_agents",
    ]) {
      expect(contract).toContain(name)
    }
  })

  it("uses the upstream bridge and ACP history instead of a native SQLite parser", () => {
    const registry = read("src-tauri/src/acp/registry.rs")
    expect(registry).toContain('package: "zcode-acp-server@0.72.0"')
    expect(registry).toContain('AgentType::Zcode => "codeg-zcode-acp"')
    expect(read("src-tauri/src/models/agent.rs")).toContain(
      "matches!(self, AgentType::Custom(_) | AgentType::Zcode)"
    )
    expect(
      fs.existsSync(path.join(root, "src-tauri/src/parsers/zcode.rs"))
    ).toBe(false)
    expect(read("src-tauri/src/acp/connection.rs")).not.toContain(
      "normalize_zcode_model_options"
    )
  })
})
