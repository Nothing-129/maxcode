/** Keep the capability out of server logs and browser referrer headers. */
export function buildConversationShareUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/+$/, "")}/share#${token}`
}

/** Prefer a LAN-reachable address when the desktop service advertises one. */
export function selectConversationShareAddress(addresses: string[]) {
  return (
    addresses.find((address) => {
      try {
        const host = new URL(address).hostname
        return host !== "127.0.0.1" && host !== "localhost" && host !== "::1"
      } catch {
        return false
      }
    }) ??
    addresses[0] ??
    null
  )
}

/** Accept only a root HTTP(S) origin; MaxCode has no static-export basePath. */
export function normalizeConversationPublicShareUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    (host.includes(":") &&
      (host.startsWith("fc") ||
        host.startsWith("fd") ||
        host.startsWith("fe80:")))
  ) {
    return true
  }
  const octets = host.split(".").map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return !host.includes(".")
  }
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

export type ConversationShareAddressSource =
  | "configured_public"
  | "runtime_public"
  | "runtime_private"
  | "lan"
  | "loopback"

export interface ResolvedConversationShareAddress {
  baseUrl: string
  source: ConversationShareAddressSource
}

/** Public configuration first; current server, LAN, and loopback are fallbacks. */
export function resolveConversationShareAddress(options: {
  publicShareUrl?: string | null
  runtimeUrl?: string | null
  addresses?: string[]
}): ResolvedConversationShareAddress | null {
  if (options.publicShareUrl) {
    const configured = normalizeConversationPublicShareUrl(
      options.publicShareUrl
    )
    if (configured) return { baseUrl: configured, source: "configured_public" }
  }

  if (options.runtimeUrl) {
    const runtime = options.runtimeUrl.replace(/\/+$/, "")
    try {
      return {
        baseUrl: runtime,
        source: isPrivateHostname(new URL(runtime).hostname)
          ? "runtime_private"
          : "runtime_public",
      }
    } catch {
      // Fall through to an advertised listener address.
    }
  }

  const selected = selectConversationShareAddress(options.addresses ?? [])
  if (!selected) return null
  try {
    const host = new URL(selected).hostname
    const source =
      host === "localhost" || host === "127.0.0.1" || host === "::1"
        ? "loopback"
        : "lan"
    return { baseUrl: selected.replace(/\/+$/, ""), source }
  } catch {
    return null
  }
}

export function readConversationShareToken(hash: string) {
  const token = hash.replace(/^#/, "")
  return /^[0-9a-fA-F]{32}$/.test(token) ? token : null
}
