import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: DeepSeek persisted history survives format upgrades", () => {
  it("includes the independent Rust behavior tests in the parser test suite", () => {
    const parser = source("src-tauri/src/parsers/deepseek.rs")
    expect(parser).toContain(
      '#[path = "../../../src/maxcode-contracts/deepseek-versioned-history.contract.rs"]'
    )
    expect(parser).toContain("mod versioned_history_contract;")
    const contract = source(
      "src/maxcode-contracts/deepseek-versioned-history.contract.rs"
    )
    expect(contract).toContain(
      "fn current_and_legacy_artifacts_preserve_visible_history()"
    )
    expect(contract).toContain(
      "fn v3_history_survives_an_incomplete_appended_frame()"
    )
  })
})
