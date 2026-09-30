import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode upstream-runtime-20260930 independent Rust contracts", () => {
  it("runs the independent behavior suite in the shared Rust backend", () => {
    expect(source("src-tauri/src/acp/connection.rs")).toContain(
      "mod maxcode_upstream_runtime_20260930_contract;"
    )
    expect(
      source("src/maxcode-contracts/upstream-runtime-20260930.contract.rs")
    ).toContain("use super::*;")
  })
})
