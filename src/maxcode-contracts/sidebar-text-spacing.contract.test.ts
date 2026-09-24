import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("sidebar text and spacing", () => {
  it("uses the same readable label metrics for conversations and both folder headers", () => {
    for (const name of [
      "sidebar-conversation-card",
      "sidebar-conversation-list",
      "sidebar-folder-group-header",
    ]) {
      const component = source(`src/components/conversations/${name}.tsx`)
      expect(component).toContain(
        "text-[0.875rem] leading-[1.375rem] font-[430]"
      )
      expect(component).toContain("py-px")
      expect(component).toContain("flex h-full")
    }
  })
  it("uses compact visual spacing while retaining title formatting and folder drag geometry", () => {
    const card = source(
      "src/components/conversations/sidebar-conversation-card.tsx"
    )
    expect(card).toContain("relative h-[1.9375rem] py-px")
    expect(card).toContain(
      "flex min-w-[0.625rem] max-w-[7.5rem] shrink-[999] items-center gap-[0.25rem] overflow-hidden text-[0.6875rem] leading-[0.8125rem] text-muted-foreground/55"
    )
    expect(card).toContain("flex min-w-0 flex-1 items-center overflow-hidden")
    expect(card).toContain('"shrink grow-0 overflow-hidden"')
    expect(card).toContain("h-[0.625rem] w-[0.625rem] shrink-0")
    expect(card).toContain("strokeWidth={1.5}")
    expect(card).toContain('data-recent-source="chat"')
    expect(card).toContain("MessageSquare")
    expect(card).toContain("maxcode-sidebar-label")
    expect(card).not.toContain('isOpenInTab && "text-primary"')
    expect(card).toContain("bg-black/[0.04] dark:bg-white/[0.06]")
    expect(card).toContain("calc(var(--conv-rail-axis, 0.875rem) + 0.875rem)")
    expect(card).toContain("formatConversationTitle(conversation.title)")
    expect(card).toContain("ConversationTitleLabel")
    expect(card).toContain('CONV_RAIL_DEPTH_STEP = "1.25rem"')
    const titleLabel = source(
      "src/components/conversations/conversation-title-label.tsx"
    )
    expect(titleLabel).toContain("w-[4ch]")
    expect(titleLabel).toContain("tabular-nums")
    expect(titleLabel).toContain("parseStructuredConversationTitle")
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(list).toContain(
      "const FOLDER_ROW_HEIGHT = 2 * ((16 * zoomLevel) / 100)"
    )
    expect(list).toContain("relative h-[2rem] rounded-full py-px")
    expect(list).toContain("h-full min-h-0 px-2 pb-1.5")
    expect(list).toContain("px-2 [--conv-rail-axis:0.875rem]")
    expect(list).toContain("recentConversationFolderLabel(conv, allFolders)")
    expect(list).toContain('conv.kind === "chat" ? t("sectionChats")')
  })
})
