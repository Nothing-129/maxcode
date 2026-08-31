import { describe, expect, it } from "vitest"
import {
  selectIdleWarmConnectionEvictions,
  type ConnectionState,
} from "@/contexts/acp-connections-context"

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

describe("idle warm connection LRU", () => {
  it("keeps two background idle owners in addition to the active connection", () => {
    const connections = new Map<string, ConnectionState>()
    const activity = new Map<string, number>()
    const open = new Set<string>()
    for (let index = 1; index <= 4; index += 1) {
      const key = `tab-${index}`
      connections.set(key, connection(`conn-${index}`))
      activity.set(key, index)
      open.add(key)
    }

    const evictions = selectIdleWarmConnectionEvictions(
      connections,
      open,
      "tab-4",
      activity
    )

    expect(evictions).toEqual([
      { connectionId: "conn-1", contextKeys: ["tab-1"] },
    ])
  })

  it("never evicts busy, permission-blocked, viewer, or delegation connections", () => {
    const connections = new Map<string, ConnectionState>([
      ["prompting", connection("prompting", { status: "prompting" })],
      ["background", connection("background", { backgroundOutstanding: 1 })],
      [
        "permission",
        connection("permission", { pendingPermission: {} as never }),
      ],
      ["viewer", connection("viewer", { isViewer: true })],
      ["delegation", connection("delegation", { isDelegationChild: true })],
      ["idle", connection("idle")],
    ])
    const open = new Set(connections.keys())

    expect(
      selectIdleWarmConnectionEvictions(connections, open, null, new Map(), 0)
    ).toEqual([{ connectionId: "idle", contextKeys: ["idle"] }])
  })

  it("counts a deduplicated backend connection once", () => {
    const connections = new Map<string, ConnectionState>([
      ["tab-a", connection("shared")],
      ["tab-b", connection("shared")],
      ["tab-c", connection("newer")],
    ])
    const activity = new Map([
      ["tab-a", 1],
      ["tab-b", 2],
      ["tab-c", 3],
    ])

    expect(
      selectIdleWarmConnectionEvictions(
        connections,
        new Set(connections.keys()),
        null,
        activity,
        1
      )
    ).toEqual([{ connectionId: "shared", contextKeys: ["tab-a", "tab-b"] }])
  })
})
