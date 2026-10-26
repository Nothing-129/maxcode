import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: compact activity summary", () => {
  it("keeps the disclosure text and chevron without a trailing divider", () => {
    const renderer = source("src/components/message/content-parts-renderer.tsx")
    const summary = renderer.slice(
      renderer.indexOf("const CompletedActivitySummary ="),
      renderer.indexOf("interface ContentPartsRendererProps")
    )

    expect(summary).toContain("<CollapsibleTrigger")
    expect(summary).toContain("<ChevronRightIcon")
    expect(summary).not.toMatch(/h-px|<Separator|<hr\b|border-t\b/)
  })
})
