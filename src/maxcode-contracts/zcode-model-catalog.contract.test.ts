import fs from "node:fs"
import { expect, it } from "vitest"

it("wires the ZCode native model catalog behavior into launch and Rust tests", () => {
  const read = (path: string) => fs.readFileSync(path, "utf8")
  expect(read("src-tauri/src/acp/connection.rs")).toContain(
    "super::zcode_model_catalog::ensure(&entry).map_err(AcpError::protocol)?"
  )
  expect(read("src-tauri/src/acp/mod.rs")).toContain("mod zcode_model_catalog;")
  expect(read("src-tauri/src/acp/zcode_model_catalog.rs")).toContain(
    '#[path = "../../../src/maxcode-contracts/zcode-model-catalog.contract.rs"]'
  )
})
