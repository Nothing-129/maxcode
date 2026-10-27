import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("active conversation selection", () => {
  it("marks only the visible selected pane in split or tiled layouts", () => {
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    expect(panel).toContain(
      "visible && (showSplitLayout || canTileG) && active"
    )
    expect(panel).not.toContain('data-active-conversation-accent=""')
    expect(panel).toContain("selectionActive={selTab.id === activeTabId}")
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    expect(header).toContain("data-selection-active={selectionActive}")
    const css = source("src/app/globals.css")
    expect(css).toContain(
      '[data-conversation-title][data-selection-active="true"]::before'
    )
    expect(css).toContain("var(--foreground) 4%, transparent")
    expect(panel).toContain('t("activeConversationIndicator")')
    expect(panel).toContain(
      "visible && !active ? () => switchTab(tab.id) : undefined"
    )
  })

  it("keeps selection independent of composer focus and task activity", () => {
    const css = source("src/app/globals.css")
    const input = source("src/components/chat/message-input.tsx")
    expect(css).not.toContain("codeg-composer-flow")
    expect(css).not.toContain("--codeg-flow-angle")
    expect(input).not.toContain("showActiveFlow")
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    const accent = panel
      .slice(
        panel.indexOf("{visible && (showSplitLayout || canTileG) && active")
      )
      .split("<OverlayHostHiddenProvider")[0]
    expect(accent).not.toMatch(
      /animate-|animation|isPrompting|isConnected|focus-within/
    )
  })

  it("pairs the pane accent with a tinted selected tab and stronger title", () => {
    const css = source("src/app/globals.css")
    const tab = source("src/components/tabs/tab-item.tsx")
    expect(tab).toContain("aria-selected={isActive}")
    expect(tab).toContain('isActive && "font-medium"')
    expect(tab).toContain("h-0.5 rounded-full bg-primary")
    expect(css).toMatch(
      /\.browser-tab-item\[data-active="true"\] \.browser-tab-content \{[^}]*background-image: linear-gradient\([^}]*var\(--primary\) 8%/
    )
  })
})
