import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: desktop chat geometry and discoverability", () => {
  it("preserves the original inline toolbar and narrow settings menu", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain("availableConfigOptions.map((option)")
    expect(input).toContain("InlineSessionConfigToggle")
    expect(input).toContain("settings={collapsedSettings}")
    expect(input).toContain('hasInlineSelectors && "@[30rem]:hidden"')
    expect(input).toContain(
      "hidden min-w-0 flex-1 items-end gap-1 @[30rem]:flex"
    )
    expect(input).not.toContain("composer-permission-controls")
    expect(input).not.toContain("composer-model-controls")
    expect(input).not.toContain("text-orange-600")
  })

  it("shows the original agent strip above the welcome composer", () => {
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    const welcome = panel.slice(panel.indexOf("<WelcomeHero tabId={tabId} />"))
    expect(welcome.indexOf("<AgentSelector")).toBeLessThan(
      welcome.indexOf("<ChatInput")
    )
    expect(welcome).not.toMatch(/compact\s+align="center"/)
    const selector = source("src/components/chat/agent-selector.tsx")
    expect(selector).toContain("visible: agents, hidden: []")
    expect(selector).toContain("rounded-full bg-muted/50")
    expect(selector).not.toContain("if (compact)")
  })

  it("aligns transcript and composer to one compact column", () => {
    for (const file of [
      "src/components/chat/conversation-shell.tsx",
      "src/components/message/virtualized-message-thread.tsx",
      "src/components/conversations/conversation-detail-panel.tsx",
    ]) {
      expect(source(file)).toContain("maxcode-chat-column")
      expect(source(file)).not.toContain("max-w-3xl")
    }
    expect(source("src/app/globals.css")).toContain("max-width: 48rem;")
    expect(source("src/contexts/sidebar-context.tsx")).toContain(
      "const DEFAULT_WIDTH = 268"
    )
  })

  it("integrates Electron traffic lights into the workspace header", () => {
    const main = source("electron/main.cjs")
    expect(main).toContain('workspace && process.platform === "darwin"')
    expect(main).toContain('titleBarStyle: "hidden"')
    expect(main).toContain("trafficLightPosition: { x: 14, y: 13 }")
    expect(main).toMatch(
      /new BrowserWindow\(\{\s*\.\.\.windowOptions\(true\),\s*\.\.\.windowState.options\(\)/
    )
    expect(source("electron/preload.cjs")).toContain(
      'dataset.nativeShell = "electron"'
    )
    expect(source("src/app/globals.css")).toContain(
      "-webkit-app-region: no-drag;"
    )
    expect(source("src/components/layout/left-edge-chrome.tsx")).toContain(
      "platformIsMac && isNativeDesktop()"
    )
    expect(source("src/app/workspace/layout.tsx")).toContain(
      "leftChromeReserve(isMac && isNativeDesktop(), zoomLevel)"
    )
  })

  it("keeps navigation visible without requiring hover", () => {
    for (const edge of ["left", "right"]) {
      const chrome = source(`src/components/layout/${edge}-edge-chrome.tsx`)
      expect(chrome).not.toContain("opacity-0")
    }
  })

  it("keeps the metadata row outside the editor's rounded shadow", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain('data-composer-status-row=""')
    expect(input).toContain("mt-1 flex min-h-5 items-center justify-between")
    expect(input).not.toContain("folderBranchPickerAttached")
    expect(input).not.toContain("rounded-b-2xl")
    expect(input.indexOf('data-composer-status-row=""')).toBeGreaterThan(
      input.indexOf("</ContextMenu>")
    )
  })

  it("gives the dock a compact gutter and the editor readable text", () => {
    expect(source("src/components/chat/chat-input.tsx")).toContain(
      "px-4 pb-2 md:pb-3"
    )
    expect(source("src/components/chat/chat-input.tsx")).toContain(
      'tall ? "min-h-30" : "min-h-26"'
    )
    const editor = source("src/components/chat/composer/rich-composer.tsx")
    expect(editor).toContain("px-4 pt-4 pb-3")
    expect(editor).not.toContain("text-base md:text-sm")
    expect(source("src/app/globals.css")).toMatch(
      /\.codeg-composer \.ProseMirror\s*\{[^}]*font-size: 0\.875rem/
    )
  })
})
