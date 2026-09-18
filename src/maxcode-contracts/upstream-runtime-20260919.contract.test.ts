import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: selected September runtime fixes", () => {
  it.each([
    ["connection.rs", "own-ask-permission"],
    ["scratch_dir.rs", "launch-scratch-budget"],
    ["delegation/listener.rs", "broker-socket-budget"],
    ["manager.rs", "native-queued-feedback"],
  ])(
    "wires %s to its independent %s Rust behavior tests",
    (module, contract) => {
      expect(source(`src-tauri/src/acp/${module}`)).toContain(
        `${contract}.contract.rs`
      )
      expect(source(`src/maxcode-contracts/${contract}.contract.rs`)).toContain(
        "fn "
      )
    }
  )

  it("retains the local server listener and six-agent catalog boundaries", () => {
    const listener = source("src-tauri/src/acp/delegation/listener.rs")
    expect(listener).toContain("bind_unix_socket(&socket_path).await?")
    expect(listener).not.toContain("tauri::")
    const registry = source("src-tauri/src/acp/registry.rs")
    expect(registry).toContain('package: "@xai-official/grok@1.0.34"')
    expect(registry).toContain('package: "@qoder-ai/qodercli@1.1.49"')
  })
})
