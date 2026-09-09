import { describe, expect, it } from "vitest"
import { chooseComposerUsageDisplayMode } from "@/components/chat/composer-generation-stats"
import { source } from "./contract-source"

describe("MaxCode: mobile conversation layout", () => {
  it("gives mobile user bubbles room without inline action buttons taking width", () => {
    expect(source("src/components/ai-elements/message.tsx")).toContain(
      "max-w-[92%] md:max-w-[82%]"
    )
    const list = source("src/components/message/message-list-view.tsx")
    expect(list).toContain("group/user-msg relative flex")
    expect(list).toContain("max-md:mb-6")
    expect(list).toContain("max-md:absolute max-md:top-full max-md:right-0")
    expect(list).toContain("max-md:absolute max-md:top-full max-md:right-7")
  })

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

  it("hides search and sent-message edit on mobile even during interaction", () => {
    expect(source("src/components/message/conversation-find.tsx")).toContain(
      "if (!active || !open) return null"
    )
    const edit = source("src/components/message/sent-message-edit-button.tsx")
    expect(edit).toContain("max-md:hidden self-end opacity-0")
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    expect(header).toMatch(
      /<DropdownMenuItem\s+className="max-md:hidden"\s+disabled=\{runtimeConversationId/
    )
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
