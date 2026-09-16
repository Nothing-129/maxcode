import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const f = vi.hoisted(() => ({
  conn: undefined as { status: string } | undefined,
  store: {
    subscribeKey: () => () => {},
    getConnectPending: () => undefined,
    getConnection: (): { status: string } | undefined => f.conn,
  },
}))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/contexts/acp-connections-context", () => ({
  useConnectionStore: () => f.store,
  useAcpActions: () => ({ reconnect: vi.fn(), getReconnectInfo: () => null }),
}))
import { ComposerConnectionStatus } from "@/components/chat/composer-connection-status"

beforeEach(() => {
  vi.useFakeTimers()
  f.conn = undefined
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it.each(["connecting", "disconnected", "error"])(
  "delays %s text and color until the same state persists",
  (status) => {
    f.conn = { status }
    const view = render(<ComposerConnectionStatus tabId="a" />)
    const color = status === "connecting" ? "text-amber-500" : "text-red-500"
    expect(screen.queryByRole("status")).toBeNull()
    expect(view.container.querySelector(`.${color}`)).toBeNull()
    act(() => vi.advanceTimersByTime(2999))
    expect(screen.queryByRole("status")).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole("status")).toHaveTextContent(status)
    expect(view.container.querySelector(`svg.${color}`)).not.toBeNull()
    f.conn = { status: "connected" }
    view.rerender(<ComposerConnectionStatus tabId="a" />)
    expect(screen.queryByRole("status")).toBeNull()
    expect(view.container.querySelector(`.${color}`)).toBeNull()
  }
)

it("resets the delay on each status change and never flashes transient states", () => {
  const view = render(<ComposerConnectionStatus tabId="a" />)
  for (const status of ["connecting", "error", "disconnected", "connected"]) {
    act(() => vi.advanceTimersByTime(1000))
    f.conn = { status }
    view.rerender(<ComposerConnectionStatus tabId="a" />)
    expect(screen.queryByRole("status")).toBeNull()
    expect(
      view.container.querySelector(".text-red-500, .text-amber-500")
    ).toBeNull()
  }
  act(() => vi.advanceTimersByTime(3000))
  expect(screen.queryByRole("status")).toBeNull()
})

it("resets the delay when switching tabs even if their statuses match", () => {
  f.conn = { status: "error" }
  const view = render(<ComposerConnectionStatus tabId="a" />)
  act(() => vi.advanceTimersByTime(3000))
  expect(screen.getByRole("status")).toHaveTextContent("error")
  view.rerender(<ComposerConnectionStatus tabId="b" />)
  expect(screen.queryByRole("status")).toBeNull()
  expect(view.container.querySelector(".text-red-500")).toBeNull()
  act(() => vi.advanceTimersByTime(3000))
  expect(screen.getByRole("status")).toHaveTextContent("error")
})
