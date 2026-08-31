import { describe, expect, it } from "vitest"

import {
  selectIdleWarmConnectionEvictions,
  type ConnectionState,
} from "@/contexts/acp-connections-context"
import { MAX_IDLE_WARM_CONNECTIONS } from "@/lib/constants"
import { source } from "./contract-source"

function connection(
  connectionId: string,
  overrides: Partial<ConnectionState> = {}
): ConnectionState {
  return {
    connectionId,
    status: "connected",
    isViewer: false,
    isDelegationChild: false,
    backgroundOutstanding: 0,
    pendingPermission: null,
    pendingAskQuestion: null,
    pendingPlanApproval: null,
    ...overrides,
  } as ConnectionState
}

describe("MaxCode contract: bounded ACP connection lifecycle", () => {
  it("keeps two idle background owners warm and evicts the LRU overflow", () => {
    expect(MAX_IDLE_WARM_CONNECTIONS).toBe(2)

    const connections = new Map<string, ConnectionState>()
    const activity = new Map<string, number>()
    for (let index = 1; index <= MAX_IDLE_WARM_CONNECTIONS + 2; index += 1) {
      connections.set(`tab-${index}`, connection(`conn-${index}`))
      activity.set(`tab-${index}`, index)
    }

    expect(
      selectIdleWarmConnectionEvictions(
        connections,
        new Set(connections.keys()),
        `tab-${MAX_IDLE_WARM_CONNECTIONS + 2}`,
        activity
      )
    ).toEqual([{ connectionId: "conn-1", contextKeys: ["tab-1"] }])
  })

  it("protects active work and deduplicates shared backend connections", () => {
    const connections = new Map<string, ConnectionState>([
      ["a", connection("shared")],
      ["b", connection("shared")],
      ["busy", connection("busy", { backgroundOutstanding: 1 })],
    ])
    expect(
      selectIdleWarmConnectionEvictions(
        connections,
        new Set(connections.keys()),
        null,
        new Map(),
        0
      )
    ).toEqual([{ connectionId: "shared", contextKeys: ["a", "b"] }])
  })

  it("keeps backend probes read-only and reaps wedged Connecting processes", () => {
    const manager = source("src-tauri/src/acp/manager.rs")
    expect(manager).toContain("pub async fn is_live(&self, conn_id: &str)")
    expect(manager).toContain("CONNECTING_TIMEOUT_SECS")
    expect(manager).toContain("liveness_probe_does_not_refresh_idle_clock")
    expect(manager).toContain("connecting_touch_does_not_postpone_watchdog")
  })
})
