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

export function readConversationShareToken(hash: string) {
  const token = hash.replace(/^#/, "")
  return /^[0-9a-fA-F]{32}$/.test(token) ? token : null
}
