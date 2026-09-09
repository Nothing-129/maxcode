import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SidebarNavigationIcon } from "@/components/layout/sidebar-navigation-icon"
import { source } from "./contract-source"

describe("sidebar reference icons", () => {
  it("renders thin decorative compose and clock drawings", () => {
    const { container } = render(
      <>
        <SidebarNavigationIcon name="compose" />
        <SidebarNavigationIcon name="clock" />
      </>
    )
    const icons = container.querySelectorAll("svg")
    expect(icons).toHaveLength(2)
    for (const icon of icons) {
      expect(icon.getAttribute("stroke-width")).toBe("1.25")
      expect(icon.getAttribute("aria-hidden")).toBe("true")
      expect(icon.getAttribute("focusable")).toBe("false")
    }
    expect(
      container.querySelector('[data-sidebar-navigation-icon="clock"] circle')
    ).not.toBeNull()
  })
  it("wires navigation and preserves open and closed folder states with thin strokes", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toContain('icon="compose"')
    expect(sidebar).toContain('icon="clock"')
    const folders = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    for (const name of [
      "FolderOpen",
      "FolderClosed",
      "FolderRoot",
      "FolderGit2",
    ]) {
      expect(folders).toMatch(
        new RegExp(
          `<${name}\\s+className="size-4 shrink-0"\\s+strokeWidth=\\{1.5\\}`
        )
      )
    }
  })
})
