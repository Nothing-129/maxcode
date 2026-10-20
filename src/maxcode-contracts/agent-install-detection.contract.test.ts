import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode installed status agrees with launch availability", () => {
  it("registers missing-command and transient-version-error Rust contracts", () => {
    expect(source("src-tauri/src/commands/acp.rs")).toContain(
      "mod maxcode_agent_install_detection_contract;"
    )
    const contract = source(
      "src/maxcode-contracts/agent-install-detection.contract.rs"
    )
    expect(contract).toContain(
      "fn detection_clears_a_stored_npx_version_whose_command_no_longer_resolves()"
    )
    expect(contract).toContain(
      "fn detection_keeps_a_stored_npx_version_whose_command_resolves_without_a_version()"
    )
  })
})
