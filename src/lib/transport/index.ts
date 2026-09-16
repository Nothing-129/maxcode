import type { Transport } from "./types"

export type { Transport, UnsubscribeFn } from "./types"

let _transport: Transport | null = null

/** Electron and browser clients share the HTTP/WebSocket backend. */
export function getTransport(): Transport {
  if (!_transport) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebTransport } = require("./web-transport") as {
      WebTransport: new (baseUrl: string) => Transport
    }
    _transport = new WebTransport(window.location.origin)
  }
  return _transport
}

/** Base URL for resource URLs that bypass the JSON transport. */
export function getServerBaseUrl(): string {
  return typeof window !== "undefined" ? window.location.origin : ""
}

/** Reset the cached transport between tests. */
export function __resetTransportForTests(): void {
  if (process.env.NODE_ENV !== "test") return
  _transport?.destroy?.()
  _transport = null
}
