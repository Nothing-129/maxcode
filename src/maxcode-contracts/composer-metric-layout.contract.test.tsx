import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { GenerationMetricItems } from "@/components/chat/composer-generation-stats"
import { source } from "./contract-source"

describe("MaxCode: composed metric layout", () => {
  it("separates performance values with vertical bars and uses the same layout for measurement", () => {
    const { container } = render(
      <GenerationMetricItems parts={["2回合", "首字4.2s", "13tok/s"]} />
    )
    expect(container.querySelectorAll("[data-generation-metric]")).toHaveLength(
      3
    )
    expect(container.firstElementChild).toHaveClass("inline-flex")
    expect(container.textContent).toBe("2回合｜首字4.2s｜13tok/s")
    const stats = source("src/components/chat/composer-generation-stats.tsx")
    expect(stats).toContain("<GenerationMetricItems parts={displayedParts} />")
    expect(stats).toContain("<GenerationMetricItems parts={parts} />")
    expect(stats).toContain(
      "<GenerationMetricItems parts={[throughputLabel]} />"
    )
  })

  it("separates usage and cost without a pill and aligns connection controls", () => {
    const usage = source("src/components/chat/composer-context-usage.tsx")
    const trigger = usage.slice(
      usage.indexOf("<PopoverTrigger"),
      usage.indexOf("</PopoverTrigger>")
    )
    expect(trigger).toContain('data-composer-usage=""')
    expect(trigger).toContain("h-6 items-center tabular-nums")
    expect(trigger).not.toContain("bg-foreground")
    expect(trigger).toContain("｜")
    expect(source("src/app/globals.css").replace(/\s+/g, " ")).toContain(
      '[aria-hidden="false"] ~ [data-composer-usage]::before'
    )
    expect(trigger).not.toMatch(/border-s|border-l/)
    const connection = source(
      "src/components/chat/composer-connection-status.tsx"
    )
    expect(connection).toContain(
      "size-6 shrink-0 items-center justify-center rounded-full"
    )
    const input = source("src/components/chat/message-input.tsx")
    const row = input.slice(
      input.indexOf('data-composer-status-row=""'),
      input.indexOf(
        "<ConversationFolderBranchPicker",
        input.indexOf('data-composer-status-row=""')
      )
    )
    expect(row).not.toMatch(/opacity-/)
  })
})
