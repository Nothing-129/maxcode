import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: mobile WebSocket control responses recover under backpressure", () => {
  it("includes independent Rust saturation and frame-order behavior tests", () => {
    const server = source("src-tauri/src/web/ws.rs")
    expect(server).toContain(
      '#[path = "../../../src/maxcode-contracts/mobile-ws-control-recovery.contract.rs"]'
    )
    expect(server).toContain("mod mobile_ws_control_recovery_contract;")
    const contract = source(
      "src/maxcode-contracts/mobile-ws-control-recovery.contract.rs"
    )
    for (const name of [
      "ping_replies_even_when_the_mobile_outbound_queue_is_full",
      "missing_connection_detaches_even_when_the_mobile_outbound_queue_is_full",
      "snapshot_precedes_buffered_live_events_with_a_full_mobile_queue",
      "replay_recovers_missed_reply_events_with_a_full_mobile_queue",
      "failed_snapshot_write_does_not_spawn_a_replacement_forwarder",
    ]) {
      expect(contract).toContain(`async fn ${name}()`)
    }
  })
})
