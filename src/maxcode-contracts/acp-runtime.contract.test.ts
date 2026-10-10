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
    asyncTasks: [],
    pendingPermission: null,
    pendingQuestion: null,
    pendingAskQuestion: null,
    pendingPlanApproval: null,
    ...overrides,
  } as ConnectionState
}

describe("MaxCode contract: bounded ACP connection lifecycle", () => {
  it("keeps ten recent idle owners truly warm for ten minutes without open panes", () => {
    expect(MAX_IDLE_WARM_CONNECTIONS).toBe(10)
    expect(IDLE_WARM_CONNECTION_TTL_MS).toBe(10 * 60 * 1000)

    const now = 1_000_000
    const connections = new Map<string, ConnectionState>()
    const activity = new Map<string, number>()
    for (let index = 1; index <= MAX_IDLE_WARM_CONNECTIONS + 2; index += 1) {
      connections.set(`tab-${index}`, connection(`conn-${index}`))
      activity.set(
        `tab-${index}`,
        now - (MAX_IDLE_WARM_CONNECTIONS + 2 - index) * 1_000
      )
    }

    expect(
      selectIdleWarmConnectionPlan(
        connections,
        new Set(),
        `tab-${MAX_IDLE_WARM_CONNECTIONS + 2}`,
        activity,
        now,
        MAX_IDLE_WARM_CONNECTIONS,
        IDLE_WARM_CONNECTION_TTL_MS,
        new Set(connections.keys())
      )
    ).toEqual({
      warm: Array.from({ length: 10 }, (_, offset) => ({
        connectionId: `conn-${11 - offset}`,
        contextKeys: [`tab-${11 - offset}`],
      })),
      evictions: [{ connectionId: "conn-1", contextKeys: ["tab-1"] }],
    })
  })

  it("expires a replaced pane even when the warm pool is not full", () => {
    const now = 1_000_000
    const plan = selectIdleWarmConnectionPlan(
      new Map([["replaced", connection("old")]]),
      new Set(),
      null,
      new Map([["replaced", now - IDLE_WARM_CONNECTION_TTL_MS - 1]]),
      now,
      MAX_IDLE_WARM_CONNECTIONS,
      IDLE_WARM_CONNECTION_TTL_MS,
      new Set(["replaced"])
    )
    expect(plan).toEqual({
      warm: [],
      evictions: [{ connectionId: "old", contextKeys: ["replaced"] }],
    })
  })

  it.each([
    { status: "prompting" },
    { backgroundOutstanding: 1 },
    { pendingPermission: {} },
    { pendingQuestion: {} },
    { pendingAskQuestion: {} },
    { pendingPlanApproval: {} },
    { isViewer: true },
    { isDelegationChild: true },
    { asyncTasks: [{ id: "task", status: "running" }] },
  ])("never reclaims a protected replaced connection: %j", (overrides) => {
    const plan = selectIdleWarmConnectionPlan(
      new Map([
        [
          "replaced",
          connection("protected", overrides as Partial<ConnectionState>),
        ],
      ]),
      new Set(),
      null,
      new Map([["replaced", 0]]),
      IDLE_WARM_CONNECTION_TTL_MS + 1,
      0,
      IDLE_WARM_CONNECTION_TTL_MS,
      new Set(["replaced"])
    )
    expect(plan).toEqual({ warm: [], evictions: [] })
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
    expect(lifecycle).toContain(
      "releaseSurfaceRef.current(contextKeyRef.current)"
    )
    expect(panel).toContain("releaseSurface(replacedTabId)")
  })

  it("keeps cold probes read-only and reaps wedged Connecting processes", () => {
    const manager = source("src-tauri/src/acp/manager.rs")
    expect(manager).toContain("pub async fn is_live(&self, conn_id: &str)")
    expect(manager).toContain("CONNECTING_TIMEOUT_SECS")
    expect(manager).toContain("liveness_probe_does_not_refresh_idle_clock")
    expect(manager).toContain("connecting_touch_does_not_postpone_watchdog")
  })

  it("keeps backup restore aware of authoritative session state and exiting processes", () => {
    const manager = source("src-tauri/src/acp/manager.rs")
    const gate = manager
      .split("pub async fn live_or_draining_agent_names")[1]
      ?.split("pub async fn probe_agent_options")[0]
    expect(gate).toContain("c.state.try_read().map_or(true")
    expect(gate).toContain("state.status")
    expect(gate).toContain("c.child_pid.load")
    expect(gate).toContain("prune_reaped(&mut draining)")
    expect(gate).not.toContain("c.status")
  })
})
