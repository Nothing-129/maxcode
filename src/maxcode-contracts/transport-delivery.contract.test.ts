import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { WebTransport } from "@/lib/transport/web-transport"

let transport: WebTransport

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.removeItem("codeg_token")
  transport = new WebTransport("http://localhost")
})

afterEach(() => {
  transport.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

it.each([200, 503])(
  "bounds stalled response bodies for HTTP %s",
  async (status) => {
    let signal!: AbortSignal
    const read = vi.fn(
      () =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          )
        })
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        signal = options.signal
        return { status, ok: status === 200, text: read, json: read }
      })
    )
    const result = expect(
      transport.call("slow", {}, { timeoutMs: 100 })
    ).rejects.toThrow("Request timed out")
    await vi.advanceTimersByTimeAsync(99)
    expect(read).toHaveBeenCalledOnce()
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(signal.aborted).toBe(true)
  }
)

it("clears the deadline after successful body delivery", async () => {
  let signal!: AbortSignal
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      signal = options.signal
      return { status: 200, ok: true, text: async () => '{"value":7}' }
    })
  )
  await expect(transport.call("fast", {}, { timeoutMs: 100 })).resolves.toEqual(
    { value: 7 }
  )
  await vi.advanceTimersByTimeAsync(100)
  expect(signal.aborted).toBe(false)
})

it("preserves the HTTP fallback when an error body is malformed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 502,
      ok: false,
      json: async () => {
        throw new SyntaxError("bad JSON")
      },
    }))
  )
  await expect(transport.call("failed")).rejects.toEqual({
    code: "network_error",
    message: "HTTP 502",
  })
})

it("delivers to later subscribers even when an earlier subscriber throws", async () => {
  const sockets: Socket[] = []
  class Socket {
    static OPEN = 1
    onmessage: ((event: { data: string }) => void) | null = null
    close() {}
    constructor() {
      sockets.push(this)
    }
  }
  vi.stubGlobal("WebSocket", Socket)
  const error = new Error("subscriber failed")
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  const healthy = vi.fn()
  await transport.subscribe("completed", () => {
    throw error
  })
  await transport.subscribe("completed", healthy)
  localStorage.setItem("codeg_token", "test")
  transport.eventStream()
  sockets[0].onmessage?.({
    data: JSON.stringify({ channel: "completed", payload: { id: 7 } }),
  })
  expect(healthy).toHaveBeenCalledWith({ id: 7 })
  expect(log).toHaveBeenCalledWith(
    "[WebTransport] handler for completed threw:",
    error
  )
})

it("runs manifest validation in CI alongside the full unit suite", () => {
  const workflow = readFileSync(".github/workflows/test.yml", "utf8")
  expect(workflow).toContain("run: pnpm upstream:guard:validate")
  expect(workflow).toContain("run: pnpm test")
})
