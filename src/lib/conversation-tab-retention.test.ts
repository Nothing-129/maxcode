import { describe, expect, it } from "vitest"

import { getConversationTabRetention } from "@/lib/conversation-tab-retention"

const idleOwner = {
  visible: false,
  status: "connected",
  isViewer: false,
  backgroundOutstanding: 0,
  hasPendingInteraction: false,
}

describe("conversation tab retention", () => {
  it("unmounts a hidden idle owner UI but preserves its warm connection", () => {
    expect(getConversationTabRetention(idleOwner)).toEqual({
      mounted: false,
      preserveOwnedConnectionOnUnmount: true,
    })
  })

  it("keeps visible, prompting, background, and interaction-blocked tabs mounted", () => {
    for (const input of [
      { ...idleOwner, visible: true },
      { ...idleOwner, status: "prompting" },
      { ...idleOwner, backgroundOutstanding: 1 },
      { ...idleOwner, hasPendingInteraction: true },
    ]) {
      expect(getConversationTabRetention(input)).toEqual({
        mounted: true,
        preserveOwnedConnectionOnUnmount: false,
      })
    }
  })

  it("unmounts an idle viewer without preserving the owner's connection", () => {
    expect(
      getConversationTabRetention({ ...idleOwner, isViewer: true })
    ).toEqual({
      mounted: false,
      preserveOwnedConnectionOnUnmount: false,
    })
  })
})
