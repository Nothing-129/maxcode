import { describe, expect, it } from "vitest"

import {
  buildConversationShareUrl,
  normalizeConversationPublicShareUrl,
  readConversationShareToken,
  resolveConversationShareAddress,
  selectConversationShareAddress,
} from "./conversation-share"

describe("conversation share capabilities", () => {
  it("keeps the token in the fragment", () => {
    expect(buildConversationShareUrl("https://codeg.example/", "abc")).toBe(
      "https://codeg.example/share#abc"
    )
  })

  it("prefers a reachable desktop address", () => {
    expect(
      selectConversationShareAddress([
        "http://127.0.0.1:3080",
        "http://192.168.1.7:3080",
      ])
    ).toBe("http://192.168.1.7:3080")
  })

  it("accepts only the fixed-width random token", () => {
    const token = "0123456789abcdef0123456789abcdef"
    expect(readConversationShareToken(`#${token}`)).toBe(token)
    expect(readConversationShareToken("#../secret")).toBeNull()
  })

  it("prefers the configured public origin", () => {
    expect(
      resolveConversationShareAddress({
        publicShareUrl: "https://maxcode.example.com/",
        runtimeUrl: "http://127.0.0.1:3080",
        addresses: ["http://192.168.1.7:3080"],
      })
    ).toEqual({
      baseUrl: "https://maxcode.example.com",
      source: "configured_public",
    })
  })

  it("recognizes public runtime origins and private fallbacks", () => {
    expect(
      resolveConversationShareAddress({
        runtimeUrl: "https://code.example.com",
      })?.source
    ).toBe("runtime_public")
    expect(
      resolveConversationShareAddress({
        runtimeUrl: "http://192.168.1.7:3080",
      })?.source
    ).toBe("runtime_private")
    expect(
      resolveConversationShareAddress({
        runtimeUrl: "https://fcloud.example.com",
      })?.source
    ).toBe("runtime_public")
    expect(
      resolveConversationShareAddress({
        runtimeUrl: "http://100.64.1.2:3080",
      })?.source
    ).toBe("runtime_private")
  })

  it("rejects public URLs that cannot host the root static export", () => {
    expect(
      normalizeConversationPublicShareUrl("https://example.com/maxcode")
    ).toBeNull()
    expect(
      normalizeConversationPublicShareUrl("file:///tmp/maxcode")
    ).toBeNull()
  })
})
