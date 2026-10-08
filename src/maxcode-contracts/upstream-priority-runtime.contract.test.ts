import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  claimRuntimeSession,
  getRuntimeSession,
  releaseRuntimeSession,
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"
import {
  reparentedViewRuntimeConversationId,
  resetTabStore,
  trackConversationView,
  useTabStore,
} from "@/stores/tab-store"
import { firstLeafId, leafIds } from "@/lib/tab-group-layout"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import type { FolderDetail } from "@/lib/types"
import { source } from "./contract-source"

vi.mock("@/lib/api", () => ({
  listOpenedTabs: vi.fn().mockResolvedValue([]),
  saveOpenedTabs: vi.fn().mockResolvedValue({}),
  getFolderConversation: vi.fn(),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(),
  onTransportReconnect: vi.fn(),
}))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetConversationRuntimeStore()
  resetAppWorkspaceStore()
  const folder = { id: 1, name: "repo", path: "/repo" } as FolderDetail
  useAppWorkspaceStore.setState({ folders: [folder], allFolders: [folder] })
  resetTabStore()
})

afterEach(() => {
  resetConversationRuntimeStore()
  resetTabStore()
  vi.useRealTimers()
})

describe("MaxCode contract: selected upstream runtime integration", () => {
  it("carries a bound draft's runtime through MaxCode's direct drop split", () => {
    const store = () => useTabStore.getState()
    store().openNewConversationTab(1, "/repo")
    const tab = store().rawTabs[0]
    const home = firstLeafId(store().groupLayout)
    store().bindConversationTab(tab.id, 42, "codex", "reply", -42)
    store().openNewConversationTab(1, "/repo", { targetGroup: home })
    const actions = useConversationRuntimeStore.getState().actions
    actions.setDbConversationId(-42, 42)
    actions.setExternalId(-42, "native-thread")
    const session = getRuntimeSession(-42)
    const unregister = trackConversationView(tab.id, home, -42)
    try {
      store().dropTabInGroup(tab.id, home, "right")
      expect(leafIds(store().groupLayout)).toHaveLength(2)
      expect(reparentedViewRuntimeConversationId(store(), tab.id)).toBe(-42)
      expect(getRuntimeSession(-42)).toBe(session)
      expect(getRuntimeSession(42)).toBeNull()
      // A stale drag payload must not undo the binding or drop the new pane.
      const before = store().rawTabs
      store().reorderTabs([tab])
      expect(store().rawTabs).toBe(before)
      expect(store().rawTabs.find((item) => item.id === tab.id)).toMatchObject({
        conversationId: 42,
        runtimeConversationId: -42,
      })
    } finally {
      unregister()
    }
  })

  it("retains session identity on immediate remount, and frees real closes", () => {
    useConversationRuntimeStore.getState().actions.setDbConversationId(-42, 42)
    const session = getRuntimeSession(-42)
    releaseRuntimeSession(-42)
    claimRuntimeSession(-42)
    vi.runAllTimers()
    expect(getRuntimeSession(-42)).toBe(session)
    releaseRuntimeSession(-42)
    vi.runAllTimers()
    expect(getRuntimeSession(-42)).toBeNull()
  })

  it("wires the independent proxy contract into the shared Rust backend", () => {
    expect(source("src-tauri/src/network/proxy.rs")).toContain(
      "proxy-loopback.contract.rs"
    )
    const registry = source("src-tauri/src/acp/registry.rs")
    expect(registry).toContain("claude-agent-acp@0.86.0")
    expect(registry).toContain("codex-acp@2.1.1")
    const cargo = source("src-tauri/Cargo.toml")
    const dependency = cargo.split("agent-client-protocol =")[1]?.split("\n")[0]
    expect(dependency).not.toContain("unstable_end_turn_token_usage")
    expect(cargo).toContain("rmcp =")
  })
})
