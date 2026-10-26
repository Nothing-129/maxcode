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
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolderId: null }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const NAV = "workspace:sidebar-nav-items"
const SORT = "workspace:sidebar-sort-mode"

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  })
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

  it.each(["workspace:left-sidebar", "workspace:right-sidebar"])(
    "keeps %s visibility and width local across actions and remounts",
    async (key) => {
      host.desktop = true
      host.values[key] = JSON.stringify({ isOpen: true, width: 800 })
      localStorage.setItem(key, JSON.stringify({ isOpen: false, width: 340 }))
      const left = await import("@/contexts/sidebar-context")
      const right = await import("@/contexts/aux-panel-context")
      const usePanel =
        key === "workspace:left-sidebar"
          ? left.useSidebarContext
          : right.useAuxPanelContext
      const wrapper =
        key === "workspace:left-sidebar"
          ? left.SidebarProvider
          : right.AuxPanelProvider
      const store = await client()
      const view = renderHook(() => usePanel(), { wrapper })
      expect(view.result.current.restored).toBe(true)
      expect(view.result.current.isOpen).toBe(false)
      expect(view.result.current.width).toBe(340)
      act(() => view.result.current.toggle())
      act(() => view.result.current.setWidth(400))
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
        isOpen: true,
        width: 400,
      })
      await act(async () => {
        host.values[key] = JSON.stringify({ isOpen: false, width: 600 })
        host.handlers.forEach((handler) =>
          handler({ key, value: host.values[key] })
        )
        await store.loadWorkspacePreferences()
      })
      expect(view.result.current.isOpen).toBe(true)
      expect(view.result.current.width).toBe(400)
      view.unmount()
      const remount = renderHook(() => usePanel(), { wrapper })
      expect(remount.result.current.isOpen).toBe(true)
      expect(remount.result.current.width).toBe(400)
      remount.unmount()
      expect(
        host.call.mock.calls.every(
          ([command]) => command === "get_workspace_preferences"
        )
      ).toBe(true)
    }
  )

  it.each([
    [390, false],
    [390, true],
    [1024, true],
  ] as const)(
    "mobile actions preserve the local PC layout at width %s, coarse %s",
    async (width, coarse) => {
      Object.defineProperty(window, "innerWidth", { value: width })
      const media = vi.spyOn(window, "matchMedia").mockReturnValue({
        ...window.matchMedia("(pointer: coarse)"),
        matches: coarse,
      })
      const key = "workspace:left-sidebar"
      localStorage.setItem(key, JSON.stringify({ isOpen: true, width: 340 }))
      const { SidebarProvider, useSidebarContext } =
        await import("@/contexts/sidebar-context")
      const { result, unmount } = renderHook(() => useSidebarContext(), {
        wrapper: SidebarProvider,
      })
      expect(result.current.isOpen).toBe(false)
      act(() => result.current.toggle())
      expect(result.current.isOpen).toBe(true)
      act(() => result.current.close())
      expect(result.current.isOpen).toBe(false)
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
        isOpen: true,
        width: 340,
      })
      unmount()
      media.mockRestore()
    }
  )

  it("does not migrate or share temporary expansion state", async () => {
    host.desktop = true
    const local = {
      "workspace:sidebar-folder-expanded": '{"1":false}',
      "workspace:sidebar-folder-group-expanded": '{"2":false}',
      "workspace:sidebar-todo-group-expanded": '{"personal:3":false}',
      "workspace:sidebar-section-collapsed": '{"folders":true}',
      "workspace:sidebar-conversation-expanded": "[4]",
    }
    for (const [key, value] of Object.entries(local)) {
      localStorage.setItem(key, value)
      host.values[key] = "{}"
    }
    const store = await client()
    const view = await import("@/lib/sidebar-view-mode-storage")
    expect(view.loadFolderExpanded()).toEqual({ 1: false })
    expect(view.loadFolderGroupExpanded()).toEqual({ 2: false })
    expect(view.loadTodoGroupExpanded()).toEqual({ "personal:3": false })
    expect(view.loadSectionCollapsed()).toEqual({ folders: true })
    expect(view.loadConversationExpanded()).toEqual([4])
    view.saveFolderExpanded({ 1: true })
    view.saveFolderGroupExpanded({ 2: true })
    view.saveTodoGroupExpanded({ "personal:3": true })
    view.saveSectionCollapsed({ folders: false })
    view.saveConversationExpanded([5])
    await store.loadWorkspacePreferences()
    expect(view.loadFolderExpanded()).toEqual({ 1: true })
    expect(view.loadFolderGroupExpanded()).toEqual({ 2: true })
    expect(view.loadTodoGroupExpanded()).toEqual({ "personal:3": true })
    expect(view.loadSectionCollapsed()).toEqual({ folders: false })
    expect(view.loadConversationExpanded()).toEqual([5])
    for (const key of [
      ...Object.keys(local),
      "workspace:left-sidebar",
      "workspace:right-sidebar",
    ]) {
      expect(store.WORKSPACE_PREFERENCE_KEYS).not.toContain(key)
    }
    expect(
      host.call.mock.calls.every(
        ([command]) => command === "get_workspace_preferences"
      )
    ).toBe(true)
  })

  it("opening files and auto-hiding the right panel cannot change host state", async () => {
    const key = "workspace:right-sidebar"
    host.values[key] = JSON.stringify({ isOpen: false, width: 320 })
    const { AuxPanelProvider, useAuxPanelContext } =
      await import("@/contexts/aux-panel-context")
    const { result, unmount } = renderHook(() => useAuxPanelContext(), {
      wrapper: AuxPanelProvider,
    })
    act(() => result.current.revealInFileTree("/tmp/example.ts"))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.activeTab).toBe("file_tree")
    act(() => result.current.setOpen(false))
    act(() => result.current.openTab("changes"))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.activeTab).toBe("changes")
    expect(JSON.parse(host.values[key]).isOpen).toBe(false)
    expect(host.call).not.toHaveBeenCalled()
    unmount()
  })
})
