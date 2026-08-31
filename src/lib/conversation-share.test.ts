import { describe, expect, it } from "vitest"

import {
  buildConversationShareUrl,
  readConversationShareToken,
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
})
