import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("conversation selection", () => {
  it("shows the selected background locally without a travelling decoration", () => {
    const card = source(
      "src/components/conversations/sidebar-conversation-card.tsx"
    )
    expect(card).not.toContain("<SelectionIndicator")
    expect(card).toContain('? "bg-[#eaeaea] dark:bg-white/[0.1]"')
  })
})
