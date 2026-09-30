import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode upstream-codex-catalog-20260930 independent Rust contracts", () => {
  it("runs the independent behavior suite in the shared Rust backend", () => {
    expect(source("src-tauri/src/commands/acp.rs")).toContain(
      "mod maxcode_upstream_codex_catalog_20260930_contract;"
    )
    expect(
      source(
        "src/maxcode-contracts/upstream-codex-catalog-20260930.contract.rs"
      )
    ).toContain("use super::*;")
  })
})
