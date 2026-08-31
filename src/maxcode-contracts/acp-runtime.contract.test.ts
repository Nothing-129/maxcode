import { describe, expect, it } from "vitest"

import {
  selectIdleWarmConnectionEvictions,
  selectIdleWarmConnectionPlan,
  type ConnectionState,
} from "@/contexts/acp-connections-context"
import {
  IDLE_WARM_CONNECTION_TTL_MS,
  MAX_IDLE_WARM_CONNECTIONS,
} from "@/lib/constants"
import { getConversationTabRetention } from "@/lib/conversation-tab-retention"
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
    pendingQuestion: null,
    pendingAskQuestion: null,
    pendingPlanApproval: null,
    ...overrides,
  } as ConnectionState
}

describe("MaxCode contract: bounded ACP connection lifecycle", () => {
  it("keeps two recent idle owners truly warm for ten minutes", () => {
    expect(MAX_IDLE_WARM_CONNECTIONS).toBe(2)
    expect(IDLE_WARM_CONNECTION_TTL_MS).toBe(10 * 60 * 1000)

    const now = 1_000_000
    const connections = new Map<string, ConnectionState>()
    const activity = new Map<string, number>()
    for (let index = 1; index <= MAX_IDLE_WARM_CONNECTIONS + 2; index += 1) {
      connections.set(`tab-${index}`, connection(`conn-${index}`))
      activity.set(`tab-${index}`, now - (4 - index) * 1_000)
    }

    expect(
      selectIdleWarmConnectionPlan(
        connections,
        new Set(connections.keys()),
        `tab-${MAX_IDLE_WARM_CONNECTIONS + 2}`,
        activity,
        now
      )
    ).toEqual({
      warm: [
        { connectionId: "conn-3", contextKeys: ["tab-3"] },
        { connectionId: "conn-2", contextKeys: ["tab-2"] },
      ],
      evictions: [{ connectionId: "conn-1", contextKeys: ["tab-1"] }],
    })
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

  it("unmounts heavy idle tab UI without dropping its warm owner", () => {
    expect(
      getConversationTabRetention({
        visible: false,
        status: "connected",
        isViewer: false,
        backgroundOutstanding: 0,
        hasPendingInteraction: false,
      })
    ).toEqual({
      mounted: false,
      preserveOwnedConnectionOnUnmount: true,
    })

    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    const lifecycle = source("src/hooks/use-connection-lifecycle.ts")
    expect(panel).toContain("preserveIdleOwnerOnUnmount")
    expect(lifecycle).toContain(
      'args.preserveIdleOwner && args.status === "connected"'
    )
  })

  it("keeps cold probes read-only and reaps wedged Connecting processes", () => {
    const manager = source("src-tauri/src/acp/manager.rs")
    expect(manager).toContain("pub async fn is_live(&self, conn_id: &str)")
    expect(manager).toContain("CONNECTING_TIMEOUT_SECS")
    expect(manager).toContain("liveness_probe_does_not_refresh_idle_clock")
    expect(manager).toContain("connecting_touch_does_not_postpone_watchdog")
  })
})
