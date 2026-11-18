import postcss from "postcss"
import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("desktop conversation surface beside the sidebar", () => {
  it("uses the final four neutral workspace colors", () => {
    expect(
      source("src/components/layout/workspace-navigation-rail.tsx")
    ).toContain("bg-[#f8f8f8] dark:bg-sidebar/80")
    expect(
      source("src/components/conversations/sidebar-conversation-card.tsx")
    ).toContain("bg-[#eaeaea]")
    expect(source("src/app/globals.css")).toMatch(
      /\[data-theme="neutral"\]\s*\{[^}]*--background: #ffffff;[^}]*--sidebar: #f5f5f5;/
    )
  })
  it("gives the neutral sidebar a distinct backing in light and dark modes", () => {
    const css = source("src/app/globals.css")
    expect(css).toMatch(/\[data-theme="neutral"\]\s*\{[^}]*--sidebar: #f5f5f5;/)
    expect(css).toMatch(
      /\[data-theme="neutral"\]\.dark\s*\{[^}]*--sidebar: #141414;/
    )
  })
  it("lightens only the desktop conversation sidebar and its corner backing", () => {
    const css = source("src/app/globals.css")
    const tokens = new Map<string, string>()
    postcss.parse(css).walkDecls("--conversation-sidebar", (decl) => {
      if (decl.parent?.type === "rule")
        tokens.set(decl.parent.selector, decl.value)
    })
    expect(Object.fromEntries(tokens)).toEqual({
      ":root": "var(--sidebar)",
      '[data-theme="neutral"]': "#f8f8f8",
      ":root:not([data-theme])": "#f8f8f8",
      '[data-theme="neutral"].dark': "#181818",
      ":root:not([data-theme]).dark": "#181818",
      ":root:not([data-theme]):not(.light)": "#181818",
    })
    expect(css).toMatch(
      /\.ws-surface-sidebar\s*\{\s*--sidebar: var\(--conversation-sidebar\);/
    )
  })
  it("clips the conversation at rounded left corners only while the sidebar is visible", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toContain('data-conversation-surface=""')
    expect(layout).toContain(
      'sidebarOpen && isConversations && "rounded-l-2xl"'
    )
    expect(layout).toContain(
      '"relative flex h-full min-h-0 flex-col overflow-hidden bg-background ws-transparent-bg"'
    )
  })
  it("backs the rounded cutouts with the sidebar surface while preserving background images", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toMatch(
      /id=\{FOLDER_SHELL_MAIN_PANEL_ID\}[\s\S]*?className="bg-\[var\(--conversation-sidebar\)\] ws-transparent-bg"/
    )
  })
})
