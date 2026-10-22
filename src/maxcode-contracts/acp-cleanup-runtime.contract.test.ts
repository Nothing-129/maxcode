import { expect, it } from "vitest"
import { source } from "./contract-source"

it("registers executable ACP cleanup runtime contracts", () => {
  expect(source("src-tauri/src/acp/connection.rs")).toContain(
    "acp-cleanup-runtime.contract.rs"
  )
  const contract = source(
    "src/maxcode-contracts/acp-cleanup-runtime.contract.rs"
  )
  expect(contract).toContain(
    "fn contended_cleanup_can_drop_outside_the_runtime_context()"
  )
  expect(contract).toContain(
    "fn cleanup_does_not_panic_when_the_runtime_has_stopped()"
  )
})
