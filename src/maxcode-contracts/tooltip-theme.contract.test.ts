import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("tooltips follow the active theme", () => {
  it("uses popover colors for the surface, text and arrow", () => {
    const tooltip = source("src/components/ui/tooltip.tsx")
    expect(tooltip).toContain(
      "border border-border bg-popover text-popover-foreground shadow-md"
    )
    expect(tooltip).toContain("bg-popover fill-popover")
    expect(tooltip).not.toContain("bg-foreground")
    expect(tooltip).not.toContain("text-background")
  })

  it("keeps selector descriptions readable on the themed surface", () => {
    const selector = source("src/components/chat/selector-tooltip.tsx")
    expect(selector).toContain("break-words text-muted-foreground")
    expect(selector).not.toContain("text-background/70")
  })
})
