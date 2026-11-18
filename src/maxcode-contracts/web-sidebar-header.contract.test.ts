import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("web sidebar header", () => {
  it("sizes the mobile sidebar to 90 percent of the viewport capped at 416px", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toContain("mobile-sidebar-drawer w-[90vw] max-w-[26rem] p-0")
  })

  it("shares the wordmark row with tools without native window clearance", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toContain(
      "const compactHeader = isMobile || !platformIsMac || !isNativeDesktop()"
    )
    expect(sidebar).toContain("{!compactHeader && (\n          // Leave native")
    expect(sidebar).toContain("{compactHeader ? (")
    expect(sidebar).toContain(
      '{!compactHeader && (\n          <div className="mb-3'
    )
  })

  it("aligns the conversation filter at the tools end of the compact header", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toMatch(
      /className="[^"]*justify-between[^"]*">\s*<SidebarWordmark compact \/>\s*\{headerDateFilter\}/
    )
  })

  it("reserves the rail titlebar area only for native macOS desktop", () => {
    const rail = source("src/components/layout/workspace-navigation-rail.tsx")
    expect(rail).toContain("!mobile && platformIsMac && isNativeDesktop() ? (")
    expect(rail).toContain('className="h-2 w-full shrink-0"')
  })
})
