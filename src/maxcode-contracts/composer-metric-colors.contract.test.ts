import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode: unified composer metric colors", () => {
  it("owns the shared text color on the trailing metrics group", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toMatch(
      /className="flex shrink-0 items-center gap-0 pr-px text-muted-foreground\/80">\s*<ComposerGenerationStats/
    )
  })

  it("inherits color for all metric text, including the cost and usage hover", () => {
    const usage = source("src/components/chat/composer-context-usage.tsx")
    const trigger = usage.slice(
      usage.indexOf("<PopoverTrigger"),
      usage.indexOf("</PopoverTrigger>")
    )
    const metricText = trigger.replace(
      /<span aria-hidden="true"[\s\S]*?<\/span>/g,
      ""
    )
    expect(metricText).not.toMatch(
      /text-(?:muted-foreground|foreground)|hover:text-|opacity-/
    )
    const stats = source("src/components/chat/composer-generation-stats.tsx")
    const label = stats.slice(
      stats.indexOf('data-generation-stats="visible"'),
      stats.indexOf('data-generation-stats="measure-full"')
    )
    expect(label).not.toMatch(/text-(?:muted-foreground|foreground)|opacity-/)
    // Keep the two-tone context ring: its track is decorative, not another
    // text-color override.
    expect(trigger).toContain('opacity="0.25"')
  })
})
