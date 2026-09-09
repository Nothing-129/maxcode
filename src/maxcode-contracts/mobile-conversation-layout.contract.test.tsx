import { describe, expect, it } from "vitest"
import { chooseComposerUsageDisplayMode } from "@/components/chat/composer-generation-stats"
import { source } from "./contract-source"

describe("MaxCode: mobile conversation layout", () => {
  it("drops cost before context and restores both when room returns", () => {
    const widths = [160, 100, 59, 100, 160]
    expect(
      widths.map((available) =>
        chooseComposerUsageDisplayMode(available, 60, 80)
      )
    ).toEqual(["full", "context", "hidden", "context", "full"])
    expect(chooseComposerUsageDisplayMode(140, 60, 80)).toBe("full")
    expect(chooseComposerUsageDisplayMode(60, 60, 80)).toBe("context")
    expect(chooseComposerUsageDisplayMode(-10, 60, 80)).toBe("hidden")
  })

  it("hides mobile search and reveals edit only on interaction", () => {
    expect(source("src/components/message/conversation-find.tsx")).toContain(
      "max-md:hidden bg-background/90"
    )
    const edit = source("src/components/message/sent-message-edit-button.tsx")
    expect(edit).toContain("self-end opacity-0")
    expect(edit).toContain("group-hover/user-msg:opacity-100")
    expect(edit).toContain("focus-visible:opacity-100")
    expect(edit).not.toContain("md:opacity-0")
  })

  it("measures usage even without performance data and hides its separator with cost", () => {
    const stats = source("src/components/chat/composer-generation-stats.tsx")
    expect(stats).not.toContain("if (!fullLabel) return null")
    expect(stats).toContain("new ResizeObserver(measure)")
    expect(stats).toContain("new MutationObserver(measure)")
    const usage = source("src/components/chat/composer-context-usage.tsx")
    const group = usage.slice(
      usage.indexOf('data-composer-cost-group=""'),
      usage.indexOf("</button>")
    )
    expect(group).toContain("｜")
    expect(group).toContain('data-composer-cost=""')
  })
})
