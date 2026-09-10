import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const f = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  touchActivity: vi.fn(),
  setActiveKey: vi.fn(),
  task: vi.fn(),
  unsubscribe: vi.fn(),
  reconnect: undefined as (() => void) | undefined,
}))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({
    onReconnect: (cb: () => void) => {
      f.reconnect = cb
      return f.unsubscribe
    },
  }),
}))
vi.mock("@/contexts/acp-connections-context", () => ({
  useAcpActions: () => f,
  getCachedSelectors: () => null,
}))
vi.mock("@/contexts/task-context", () => ({
  useTaskContext: () => ({
    addTask: f.task,
    updateTask: f.task,
    removeTask: f.task,
  }),
}))
vi.mock("@/hooks/use-connection", () => ({
  useConnection: () => ({
    status: "connected",
    connect: f.connect,
    disconnect: f.disconnect,
    selectorsReady: true,
    hasCachedSelectors: true,
    modes: null,
    configOptions: null,
    backgroundOutstanding: 0,
  }),
}))
import { useConnectionLifecycle } from "@/hooks/use-connection-lifecycle"

function mount(active = true) {
  return renderHook(() =>
    useConnectionLifecycle({
      contextKey: "mobile-tab",
      agentType: "claude_code",
      isActive: active,
      workingDir: "/repo",
      sessionId: "original-session",
      conversationId: 42,
    })
  )
}

describe("mobile session recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    f.reconnect = undefined
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
  })

  it("reconciles a retained connected session on wake without composer refocus", async () => {
    const h = mount()
    await act(async () => {})
    f.connect.mockClear()
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("pageshow"))
      window.dispatchEvent(new Event("focus"))
    })
    expect(f.connect).toHaveBeenCalledTimes(1)
    expect(f.connect).toHaveBeenCalledWith(
      "claude_code",
      "/repo",
      "original-session",
      42
    )
    expect(f.disconnect).not.toHaveBeenCalled()
    h.unmount()
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    f.connect.mockClear()
    await act(async () => window.dispatchEvent(new Event("online")))
    expect(f.connect).not.toHaveBeenCalled()
  })

  it("retries after transport recovery but never wakes hidden sessions", async () => {
    mount()
    await act(async () => {})
    f.connect.mockClear()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    await act(async () => {
      f.reconnect?.()
    })
    expect(f.connect).not.toHaveBeenCalled()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
    await act(async () => {
      f.reconnect?.()
    })
    expect(f.connect).toHaveBeenCalledTimes(1)
  })

  it("does not reconnect inactive conversations", async () => {
    mount(false)
    await act(async () => window.dispatchEvent(new Event("pageshow")))
    expect(f.connect).not.toHaveBeenCalled()
  })

  it("checks connected entries before reuse and exposes status outside the popover", () => {
    const provider = readFileSync(
      "src/contexts/acp-connections-context.tsx",
      "utf8"
    )
    expect(provider).toMatch(
      /existing.status === "connected" \|\|\s*existing.status === "prompting" \|\|\s*existing.status === "connecting"/
    )
    const status = readFileSync(
      "src/components/chat/composer-connection-status.tsx",
      "utf8"
    )
    expect(status.slice(0, status.indexOf("<PopoverContent"))).toContain(
      'role="status"'
    )
  })
})
