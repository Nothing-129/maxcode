import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("secondary tool group summaries", () => {
  it("keeps tool summaries smaller and quieter than response prose", () => {
    const code = source("src/components/message/content-parts-renderer.tsx")
    const group = code.slice(
      code.indexOf("const ToolGroupPart ="),
      code.indexOf("// ── Main renderer")
    )
    expect(group).toContain("h-6 max-w-full")
    expect(group).toContain("rounded-md bg-muted/30 px-2")
    expect(group).toContain(
      "text-[0.6875rem] leading-4 font-normal text-muted-foreground"
    )
    expect(group).not.toContain("py-2")
    expect(group).not.toContain("rounded-full")
    expect(code).toContain('data-activity-rows className="space-y-1"')
  })

  it("applies the same hierarchy to combined activity count summaries", () => {
    const code = source("src/components/message/content-parts-renderer.tsx")
    const summary = code.slice(
      code.indexOf("const CompletedActivitySummary ="),
      code.indexOf("interface ContentPartsRendererProps")
    )
    expect(summary).toContain("h-6 min-w-0")
    expect(summary).toContain(
      "text-[0.6875rem] leading-4 font-normal text-muted-foreground"
    )
    expect(summary).toContain("size-3 shrink-0 opacity-60")
    expect(summary).not.toContain("text-[0.8125rem]")
  })
})
