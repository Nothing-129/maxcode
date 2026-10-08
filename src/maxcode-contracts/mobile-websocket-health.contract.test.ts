import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebTransport } from "@/lib/transport/web-transport"

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  sent: object[] = []
  constructor() {
    Socket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = Socket.OPEN
    this.onopen?.()
  }
  ready() {
    this.onmessage?.({
      data: JSON.stringify({ channel: "__ready__", payload: null }),
    })
  }
}

let transport: WebTransport
let fetchMock: ReturnType<typeof vi.fn>
const socket = () => Socket.instances[Socket.instances.length - 1]
const healthy = () => {
  socket().open()
  socket().ready()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  Socket.instances = []
  vi.stubGlobal("WebSocket", Socket)
  localStorage.setItem("codeg_token", "mobile-token")
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
  fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true })
  vi.stubGlobal("fetch", fetchMock)
  transport = new WebTransport("https://maxcode.example")
  transport.eventStream()
})

afterEach(() => {
  transport.destroy()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("mobile WebSocket health", () => {
  it.each([false, true])(
    "exposes and retries a stalled connection (socket open: %s)",
    async (open) => {
      const stalled = socket()
      if (open) stalled.open()
      expect(transport.getConnectionSnapshot()).toBe("connecting")
      await vi.advanceTimersByTimeAsync(8_000)
      expect(transport.getConnectionSnapshot()).toBe("reconnecting")
      expect(stalled.readyState).toBe(3)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(fetchMock).toHaveBeenCalledWith(
        "https://maxcode.example/api/health",
        expect.objectContaining({ method: "POST" })
      )
      expect(socket()).not.toBe(stalled)
      healthy()
      expect(transport.getConnectionSnapshot()).toBe("connected")
      expect(localStorage.getItem("codeg_token")).toBe("mobile-token")
    }
  )

  it("waits for the replacement server-ready frame after a forced reconnect", async () => {
    healthy()
    await transport.waitForReady()
    const old = socket()
    transport.reconnectNow()
    const ready = vi.fn()
    const waiting = transport.waitForReady().then(ready)
    await vi.advanceTimersByTimeAsync(0)
    expect(socket()).not.toBe(old)
    expect(ready).not.toHaveBeenCalled()
    socket().open()
    await vi.advanceTimersByTimeAsync(100)
    expect(ready).not.toHaveBeenCalled()
    socket().ready()
    await waiting
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it("keeps an in-flight readiness waiter across socket replacements", async () => {
    const ready = vi.fn()
    const waiting = transport.waitForReady().then(ready)
    transport.reconnectNow()
    await vi.advanceTimersByTimeAsync(0)
    healthy()
    await waiting
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it("shortens a pending background heartbeat on wake without extending it again", async () => {
    healthy()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(socket().sent).toContainEqual({ action: "ping" })
    window.dispatchEvent(new Event("focus"))
    await vi.advanceTimersByTimeAsync(2_000)
    document.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(999)
    expect(transport.getConnectionSnapshot()).toBe("connected")
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.getConnectionSnapshot()).toBe("reconnecting")
  })

  it("does not hide a disconnected socket while waiting for the native close event", async () => {
    healthy()
    socket().readyState = 3
    window.dispatchEvent(new Event("focus"))
    expect(transport.getConnectionSnapshot()).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("shows network loss immediately and preserves the agent's session token", () => {
    healthy()
    window.dispatchEvent(new Event("offline"))
    expect(transport.getConnectionSnapshot()).toBe("reconnecting")
    expect(localStorage.getItem("codeg_token")).toBe("mobile-token")
  })

  it("cancels connection watchdogs and wake listeners on teardown", async () => {
    transport.destroy()
    await vi.advanceTimersByTimeAsync(60_000)
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("offline"))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(Socket.instances).toHaveLength(1)
  })

  it("keeps a replacement handshake across repeated wake signals", async () => {
    healthy()
    transport.reconnectNow()
    await vi.advanceTimersByTimeAsync(0)
    const replacement = socket()
    for (const event of ["online", "focus", "pageshow"]) {
      window.dispatchEvent(new Event(event))
      await vi.advanceTimersByTimeAsync(100)
      expect(socket()).toBe(replacement)
      expect(replacement.readyState).toBe(0)
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    healthy()
    expect(transport.getConnectionSnapshot()).toBe("connected")
  })

  it("detects an expired ping immediately after mobile timers were frozen", async () => {
    healthy()
    await vi.advanceTimersByTimeAsync(20_000)
    vi.setSystemTime(Date.now() + 60_000)
    window.dispatchEvent(new Event("focus"))
    expect(transport.getConnectionSnapshot()).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries an expired handshake on wake even when its timer has not run", async () => {
    const stalled = socket()
    vi.setSystemTime(Date.now() + 60_000)
    window.dispatchEvent(new Event("focus"))
    expect(stalled.readyState).toBe(3)
    expect(transport.getConnectionSnapshot()).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(0)
    expect(socket()).not.toBe(stalled)
  })
})
