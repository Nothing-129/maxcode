import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("compact selection action toolbar", () => {
  it("uses a subtle themed surface and consistent compact actions", () => {
    const code = source("src/components/message/selection-action-bubble.tsx")
    expect(code).toContain(
      "rounded-xl border border-border/60 bg-popover p-1 text-popover-foreground shadow-sm"
    )
    expect(code).not.toContain("shadow-md")
    expect(code).toContain("h-7 gap-1.5 rounded-md px-2 text-xs font-normal")
    expect(code).toContain("[&_svg]:size-3.5")
    expect(code.match(/className=\{ACTION_CLASS_NAME\}/g)).toHaveLength(4)
  })
})
