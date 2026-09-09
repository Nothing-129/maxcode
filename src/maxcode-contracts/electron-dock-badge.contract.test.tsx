import { act, render, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const badgeWindow = vi.hoisted(() => ({
  setBadgeCount: vi.fn(async () => undefined),
}))
const getCurrentWindowMock = vi.fn(async () => null)
const isLocalDesktopMock = vi.fn(() => true)

vi.mock("@/hooks/use-is-mac", () => ({
  useIsMac: () => true,
}))
vi.mock("@/lib/platform", () => ({
  getCurrentWindow: (...args: []) => getCurrentWindowMock(...args),
  isLocalDesktop: (...args: []) => isLocalDesktopMock(...args),
}))
vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: () => null,
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ isConversations: false }),
}))
vi.mock("@/lib/conversation-unread", () => ({
  collectViewedConversationIds: vi.fn(() => []),
}))
vi.mock("@/stores/tab-store", () => ({
  useTabStore: {
    getState: () => ({
      tabs: [],
      groupLayout: { id: "root" },
      groupOf: {},
      groupSelection: {},
      tileByGroup: {},
    }),
    subscribe: () => () => {},
  },
}))

import { ConversationUnreadSync } from "@/components/conversations/conversation-unread-sync"
import {
  resetConversationUnreadStore,
  useConversationUnreadStore,
} from "@/stores/conversation-unread-store"

it("delivers preload badge requests to the trusted macOS Dock handler", async () => {
  const handlers = new Map<string, (event: unknown, count?: unknown) => void>()
  const setBadge = vi.fn()
  let trusted = true
  const main = readFileSync(resolve("electron/main.cjs"), "utf8")
  const installBridge = main.slice(
    main.indexOf("function installBridge()"),
    main.indexOf("function installSessionSecurity()")
  )
  runInNewContext(`${installBridge}\ninstallBridge()`, {
    ipcMain: {
      on: vi.fn(),
      handle: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
    },
    trustedSender: () => trusted,
    BrowserWindow: { fromWebContents: () => ({}) },
    process: { platform: "darwin" },
    app: { dock: { setBadge } },
  })
  let bridge!: { setBadgeCount(count?: unknown): Promise<void> }
  runInNewContext(readFileSync(resolve("electron/preload.cjs"), "utf8"), {
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name: string, value: typeof bridge) => {
          bridge = value
        },
      },
      ipcRenderer: {
        sendSync: () => ({ token: "test-token", storage: {} }),
        invoke: async (name: string, count: unknown) => {
          const handler = handlers.get(name)
          if (!handler) throw new Error(`Missing IPC handler: ${name}`)
          handler({ sender: {} }, count)
        },
      },
    }),
    window: { addEventListener: vi.fn() },
    localStorage: { removeItem: vi.fn() },
    setInterval: vi.fn(),
  })
  await bridge.setBadgeCount(3)
  expect(setBadge).toHaveBeenLastCalledWith("3")
  await bridge.setBadgeCount()
  expect(setBadge).toHaveBeenLastCalledWith("")
  await bridge.setBadgeCount(0)
  expect(setBadge).toHaveBeenLastCalledWith("")
  for (const invalid of [-1, 1.5, "2", NaN, Infinity]) {
    await expect(bridge.setBadgeCount(invalid)).rejects.toThrow(
      "Invalid badge count"
    )
  }
  trusted = false
  await expect(bridge.setBadgeCount(4)).rejects.toThrow(
    "Untrusted desktop IPC sender"
  )
  expect(setBadge).toHaveBeenCalledTimes(3)
})

describe("MaxCode contract: Electron macOS Dock unread badge", () => {
  beforeEach(() => {
    localStorage.clear()
    resetConversationUnreadStore()
    vi.clearAllMocks()
    isLocalDesktopMock.mockReturnValue(true)
    Object.defineProperty(window, "maxcodeElectron", {
      configurable: true,
      value: badgeWindow,
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, "maxcodeElectron")
  })

  it("syncs visible unread conversations to the macOS Dock badge and clears it", async () => {
    render(<ConversationUnreadSync />)

    await waitFor(() =>
      expect(badgeWindow.setBadgeCount).toHaveBeenCalledWith(undefined)
    )

    act(() => {
      useConversationUnreadStore.getState().setVisible([7, 8])
      useConversationUnreadStore.getState().noteActivity(7)
      useConversationUnreadStore.getState().noteActivity(8)
    })
    await waitFor(() =>
      expect(badgeWindow.setBadgeCount).toHaveBeenLastCalledWith(2)
    )
    expect(getCurrentWindowMock).not.toHaveBeenCalled()

    act(() => {
      useConversationUnreadStore.getState().markRead(7)
      useConversationUnreadStore.getState().markRead(8)
    })
    await waitFor(() =>
      expect(badgeWindow.setBadgeCount).toHaveBeenLastCalledWith(undefined)
    )
  })

  it("excludes unread conversations hidden from the sidebar", async () => {
    render(<ConversationUnreadSync />)

    act(() => {
      useConversationUnreadStore.getState().setVisible([7])
      useConversationUnreadStore.getState().noteActivity(7)
      useConversationUnreadStore.getState().noteActivity(8)
    })

    await waitFor(() =>
      expect(badgeWindow.setBadgeCount).toHaveBeenLastCalledWith(1)
    )
  })

  it("does not touch the local Dock badge outside local desktop mode", async () => {
    isLocalDesktopMock.mockReturnValue(false)
    render(<ConversationUnreadSync />)

    act(() => {
      useConversationUnreadStore.getState().noteActivity(7)
    })

    expect(getCurrentWindowMock).not.toHaveBeenCalled()
    expect(badgeWindow.setBadgeCount).not.toHaveBeenCalled()
  })
})
