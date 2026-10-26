import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  values: {} as Record<string, string>,
  desktop: false,
  fail: false,
  handlers: [] as ((event: { key: string; value: string }) => void)[],
  reconnect: [] as (() => void)[],
  call: vi.fn(),
}))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: host.call }),
}))
vi.mock("@/lib/platform", () => ({
  isElectron: () => host.desktop,
  subscribe: async (
    _name: string,
    handler: (event: { key: string; value: string }) => void
  ) => {
    host.handlers.push(handler)
    return () => {}
  },
  onTransportReconnect: (callback: () => void) => {
    host.reconnect.push(callback)
  },
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const NAV = "workspace:sidebar-nav-items"
const SORT = "workspace:sidebar-sort-mode"

beforeEach(() => {
  vi.resetModules()
  host.values = {}
  host.desktop = false
  host.fail = false
  host.handlers = []
  host.reconnect = []
  host.call.mockReset().mockImplementation(async (command, params) => {
    if (command === "get_workspace_preferences") return { ...host.values }
    if (host.fail) throw new Error("Host unavailable")
    const { key, value, initialize_only } = params
    if (!initialize_only || host.values[key] === undefined)
      host.values[key] = value
    for (const handler of host.handlers)
      handler({ key, value: host.values[key] })
    return host.values[key]
  })
  localStorage.clear()
})

async function client() {
  const store = await import("@/lib/workspace-preferences-store")
  store.subscribeWorkspacePreferences(() => {})
  await store.loadWorkspacePreferences()
  return store
}

describe("host-owned workspace preferences", () => {
  it("web ignores stale local values and reads host navigation and sorting", async () => {
    localStorage.setItem(NAV, '{"tasks":false}')
    localStorage.setItem(SORT, "created")
    host.values = { [NAV]: '{"tasks":true}', [SORT]: "updated" }
    const store = await client()
    expect(store.workspacePreferenceStorage.getItem(NAV)).toBe('{"tasks":true}')
    expect(store.workspacePreferenceStorage.getItem(SORT)).toBe("updated")
    expect(
      host.call.mock.calls.every(
        ([command]) => command === "get_workspace_preferences"
      )
    ).toBe(true)
  })

  it("only desktop seeds missing keys and preserves existing host values", async () => {
    host.desktop = true
    host.values[NAV] = '{"tasks":true}'
    localStorage.setItem(NAV, '{"tasks":false}')
    localStorage.setItem(SORT, "created")
    await client()
    expect(host.values).toEqual({ [NAV]: '{"tasks":true}', [SORT]: "created" })
    expect(host.call).toHaveBeenCalledWith("set_workspace_preference", {
      key: SORT,
      value: "created",
      initialize_only: true,
    })
    expect(localStorage.getItem(SORT)).toBeNull()
  })

  it("failed migration retains local settings for retry", async () => {
    host.desktop = true
    host.fail = true
    localStorage.setItem(SORT, "created")
    const store = await import("@/lib/workspace-preferences-store")
    await expect(store.loadWorkspacePreferences()).rejects.toThrow()
    expect(localStorage.getItem(SORT)).toBe("created")
    host.fail = false
    await store.loadWorkspacePreferences()
    expect(host.values[SORT]).toBe("created")
  })

  it("independent clients share edits without overwriting unrelated keys", async () => {
    const first = await client()
    vi.resetModules()
    const second = await client()
    first.workspacePreferenceStorage.setItem(NAV, '{"tasks":false}')
    await waitFor(() =>
      expect(second.workspacePreferenceStorage.getItem(NAV)).toBe(
        '{"tasks":false}'
      )
    )
    second.workspacePreferenceStorage.setItem(SORT, "created")
    await waitFor(() =>
      expect(first.workspacePreferenceStorage.getItem(SORT)).toBe("created")
    )
    expect(host.values[NAV]).toBe('{"tasks":false}')
  })

  it("a slow fetch cannot undo a write acknowledged while it was in flight", async () => {
    host.values[SORT] = "updated"
    const store = await client()
    let finish!: (values: Record<string, string>) => void
    host.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const loading = store.loadWorkspacePreferences()
    store.workspacePreferenceStorage.setItem(SORT, "created")
    await waitFor(() => expect(host.values[SORT]).toBe("created"))
    finish({ [SORT]: "updated" })
    await loading
    expect(store.workspacePreferenceStorage.getItem(SORT)).toBe("created")
  })

  it("reconnect fetches edits missed while disconnected", async () => {
    const store = await client()
    host.values[SORT] = "created"
    host.reconnect.forEach((callback) => callback())
    await waitFor(() =>
      expect(store.workspacePreferenceStorage.getItem(SORT)).toBe("created")
    )
  })

  it("failed writes restore the host value and notify consumers", async () => {
    host.values[SORT] = "updated"
    const store = await client()
    const listener = vi.fn()
    store.subscribeWorkspacePreferences(listener)
    host.fail = true
    store.workspacePreferenceStorage.setItem(SORT, "created")
    await waitFor(() =>
      expect(store.workspacePreferenceStorage.getItem(SORT)).toBe("updated")
    )
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it("mobile initial closure does not persist over desktop panel state", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    })
    host.values["workspace:left-sidebar"] = JSON.stringify({
      isOpen: true,
      width: 340,
    })
    const { SidebarProvider, useSidebarContext } =
      await import("@/contexts/sidebar-context")
    const { result, unmount } = renderHook(() => useSidebarContext(), {
      wrapper: SidebarProvider,
    })
    await waitFor(() => expect(result.current.restored).toBe(true))
    expect(result.current.isOpen).toBe(false)
    expect(result.current.width).toBe(340)
    expect(
      host.call.mock.calls.some(
        ([command]) => command === "set_workspace_preference"
      )
    ).toBe(false)
    await act(async () => {
      result.current.setWidth(360)
    })
    await waitFor(() =>
      expect(JSON.parse(host.values["workspace:left-sidebar"]).width).toBe(360)
    )
    expect(JSON.parse(host.values["workspace:left-sidebar"]).isOpen).toBe(true)
    expect(result.current.isOpen).toBe(false)
    unmount()
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    })
  })
})
