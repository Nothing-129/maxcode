import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("desktop sidebar compose action", () => {
  it("keeps compose full-width and centered while applying the desktop surface", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toMatch(/icon="compose"\s+conversationSurface={!isMobile}/)
    expect(sidebar).toContain("h-8 min-w-0 flex-1 items-center justify-center")
    expect(sidebar).not.toContain("flex-none justify-start")
  })

  it("shares the conversation selection gray in light and dark themes", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    const card = source(
      "src/components/conversations/sidebar-conversation-card.tsx"
    )
    const surface = "bg-black/[0.07] dark:bg-white/[0.1]"
    expect(card).toContain(surface)
    expect(sidebar).toContain(surface)
  })
})
