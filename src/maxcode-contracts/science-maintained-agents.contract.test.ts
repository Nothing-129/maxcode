import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: science status follows maintained skill agents", () => {
  it("runs the independent Rust catalog behavior test", () => {
    expect(source("src-tauri/src/commands/science.rs")).toContain(
      "science-maintained-agents.contract.rs"
    )
    const contract = source(
      "src/maxcode-contracts/science-maintained-agents.contract.rs"
    )
    expect(contract).toContain(
      "fn science_status_catalog_preserves_legacy_rows_and_covers_every_maintained_skill_agent()"
    )
    expect(contract).toContain("skill_storage_spec(*agent).is_some()")
    expect(contract).toContain("is_maintained_agent(*agent)")
  })
})
