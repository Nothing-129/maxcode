import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import type { WebConnState } from "@/lib/transport/web-transport"

const f = vi.hoisted(() => ({
  transportStatus: "connected" as WebConnState,
  listeners: new Set<() => void>(),
  conn: {
    agentType: "claude_code",
    status: "prompting" as "connected" | "prompting",
    isViewer: false,
    backgroundOutstanding: 1,
  },
  reconnectInfo: null as { agentType: string } | null,
  reconnectAcp: vi.fn(async () => true),
  reconnectWeb: vi.fn(),
  store: {
    subscribeKey: () => () => {},
    getConnectPending: () => undefined,
    getConnection: () => f.conn,
  },
}))

vi.mock("@/contexts/acp-connections-context", () => ({
  useConnectionStore: () => f.store,
  useAcpActions: () => ({
    reconnect: f.reconnectAcp,
    getReconnectInfo: () => f.reconnectInfo,
  }),
}))
vi.mock("@/lib/transport/web-connection-store", () => ({
  subscribeWebConnection: (callback: () => void) => {
    f.listeners.add(callback)
    return () => f.listeners.delete(callback)
  },
  getWebConnectionSnapshot: () => f.transportStatus,
  getWebConnectionServerSnapshot: () => "connected",
  reconnectWebNow: f.reconnectWeb,
}))

import { ComposerConnectionStatus } from "@/components/chat/composer-connection-status"

const copy = enMessages.Folder.statusBar.connection
const webCopy = enMessages.WebConnection

function renderStatus(tabId: string | null = "mobile-tab") {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ComposerConnectionStatus tabId={tabId} />
    </NextIntlClientProvider>
  )
}

function setTransportStatus(status: WebConnState) {
  act(() => {
    f.transportStatus = status
    f.listeners.forEach((callback) => callback())
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  f.listeners.clear()
  f.transportStatus = "connected"
  f.conn.status = "prompting"
  f.reconnectInfo = null
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("mobile composer server connection contract", () => {
  it("shows the first handshake as connecting and retries without interrupting the agent", () => {
    vi.useFakeTimers()
    f.transportStatus = "connecting"
    const view = renderStatus()
    const trigger = screen.getByRole("button", {
      name: `Agent connection: ${copy.connecting}`,
    })
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(3_000))
    expect(screen.getByRole("status")).toHaveTextContent(copy.connecting)
    expect(view.container.querySelector("svg.text-amber-500")).not.toBeNull()
    expect(view.container.querySelector(".text-red-500")).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getAllByText(copy.connecting)).toHaveLength(2)
    expect(
      screen.queryByText(webCopy.disconnectedTitle)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(copy.prompting)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.reconnectInterrupts)).not.toBeInTheDocument()
    const reconnect = screen.getByRole("button", { name: webCopy.reconnectNow })
    expect(reconnect).toBeEnabled()
    fireEvent.click(reconnect)
    expect(f.reconnectWeb).toHaveBeenCalledTimes(1)
    expect(f.reconnectAcp).not.toHaveBeenCalled()
  })

  it.each([
    ["connected", "reconnecting", webCopy.disconnectedTitle],
    ["prompting", "reconnecting", webCopy.disconnectedTitle],
    ["connected", "unauthorized", webCopy.sessionExpiredTitle],
    ["prompting", "unauthorized", webCopy.sessionExpiredTitle],
  ] as const)(
    "overrides stale ACP %s when the server is %s and retries only the transport",
    (agentStatus, transportStatus, label) => {
      f.conn.status = agentStatus
      renderStatus()
      setTransportStatus(transportStatus)

      const trigger = screen.getByRole("button", {
        name: `Agent connection: ${label}`,
      })
      expect(trigger).toHaveAttribute("title", `Claude Code - ${label}`)
      fireEvent.click(trigger)

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.queryByText(copy.connected)).not.toBeInTheDocument()
      expect(screen.queryByText(copy.prompting)).not.toBeInTheDocument()
      expect(
        screen.queryByText(copy.reconnectInterrupts)
      ).not.toBeInTheDocument()
      expect(
        screen.getByText(
          transportStatus === "unauthorized"
            ? webCopy.sessionExpiredDescription
            : webCopy.reconnectingDescription
        )
      ).toBeInTheDocument()

      // No remembered ACP connect params are required to recover the server
      // link; the already-running agent must not be killed during recovery.
      const reconnect = screen.getByRole("button", {
        name: webCopy.reconnectNow,
      })
      expect(reconnect).toBeEnabled()
      fireEvent.click(reconnect)
      expect(f.reconnectWeb).toHaveBeenCalledTimes(1)
      expect(f.reconnectAcp).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["reconnecting", webCopy.disconnectedTitle],
    ["unauthorized", webCopy.sessionExpiredTitle],
  ] as const)(
    "shows persistent %s inline after the grace period and clears on recovery",
    (status, label) => {
      vi.useFakeTimers()
      const view = renderStatus()
      setTransportStatus(status)
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
      expect(view.container.querySelector(".text-red-500")).toBeNull()

      act(() => vi.advanceTimersByTime(2999))
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByRole("status")).toHaveTextContent(label)
      expect(view.container.querySelector("svg.text-red-500")).not.toBeNull()

      setTransportStatus("connected")
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
      expect(view.container.querySelector(".text-red-500")).toBeNull()
      expect(
        screen.getByRole("button", {
          name: `Agent connection: ${copy.connected}`,
        })
      ).toBeInTheDocument()
    }
  )

  it("restores the agent reconnect and interruption warning when the link recovers", async () => {
    f.reconnectInfo = { agentType: "claude_code" }
    renderStatus()
    setTransportStatus("reconnecting")
    fireEvent.click(
      screen.getByRole("button", {
        name: `Agent connection: ${webCopy.disconnectedTitle}`,
      })
    )

    setTransportStatus("connected")
    expect(screen.getByText(copy.prompting)).toBeInTheDocument()
    expect(screen.getByText(copy.reconnectInterrupts)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: copy.reconnect }))
    })
    expect(f.reconnectAcp).toHaveBeenCalledWith("mobile-tab")
    expect(f.reconnectWeb).not.toHaveBeenCalled()
  })

  it("does not offer reconnect without a current tab", () => {
    f.transportStatus = "reconnecting"
    renderStatus(null)
    fireEvent.click(
      screen.getByRole("button", {
        name: `Agent connection: ${webCopy.disconnectedTitle}`,
      })
    )
    expect(
      screen.getByRole("button", { name: webCopy.reconnectNow })
    ).toBeDisabled()
  })
})
