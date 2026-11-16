import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("sidebar conversation cursor", () => {
  it("uses an arrow at rest while preserving the drag gesture", () => {
    const card = source(
      "src/components/conversations/sidebar-conversation-card.tsx"
    )
    expect(card).toContain("md:cursor-default md:active:cursor-grabbing")
    expect(card).not.toContain("md:cursor-grab ")
    expect(card).toContain("onPointerDown={handlePointerDown}")
    expect(card).toContain("onConversationPointerDown?.(event, conversation)")
  })
})
