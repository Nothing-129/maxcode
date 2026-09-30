import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Button } from "@/components/ui/button"
import { source } from "./contract-source"

afterEach(cleanup)

describe("MaxCode: composer navigation fits beside connection controls", () => {
  it.each([
    ["folder", "src/components/chat/conversation-context-bar.tsx", "8.75rem"],
    ["branch", "src/components/layout/branch-dropdown.tsx", "10rem"],
  ])(
    "allows the %s chip to shrink and ellipsize long names",
    (_, path, cap) => {
      const content = source(path)
      const classes = content.match(/"(min-w-0 [^"]*gap-0\.5 px-1\.5)"/)?.[1]
      expect(classes).toBeDefined()
      // Exercise Button's class merging too: its default shrink-0 must be gone.
      render(<Button className={classes}>long navigation label</Button>)
      expect(screen.getByRole("button")).toHaveClass("min-w-0", "shrink")
      expect(screen.getByRole("button")).not.toHaveClass("shrink-0")
      expect(content).toContain(`max-w-[${cap}] truncate`)
      expect(content).toContain("size-3 shrink-0 text-muted-foreground/60")
    }
  )

  it("reserves the trailing controls while the navigation group shrinks", () => {
    const composer = source("src/components/chat/message-input.tsx")
    const row = composer.slice(composer.indexOf('data-composer-status-row=""'))
    expect(row).toContain('className="flex min-w-0 items-center gap-1"')
    expect(row).toContain('className="flex shrink-0 items-center gap-0 pr-px')
  })
})
