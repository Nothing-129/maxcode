import { render } from "@testing-library/react"
import { MessagesSquare } from "lucide-react"
import { describe, expect, it } from "vitest"
import {
  SidebarNavigationIcon,
  SidebarRailIcon,
} from "@/components/layout/sidebar-navigation-icon"
import { source } from "./contract-source"
import { NAVIGATION_IDS } from "@/contexts/sidebar-navigation-context"

describe("sidebar reference icons", () => {
  it.each(NAVIGATION_IDS)(
    "keeps %s on the same icon grid when selection changes",
    (name) => {
      const { container, rerender } = render(
        <SidebarRailIcon name={name} selected={false} />
      )
      const outline = container.querySelector("svg")!
      expect(outline).toHaveClass("size-5")
      expect(outline).toHaveAttribute("viewBox", "0 0 24 24")
      expect(outline).toHaveAttribute("stroke-width", "1.75")
      expect(outline).toHaveAttribute("stroke-linecap", "round")
      expect(outline).toHaveAttribute("stroke-linejoin", "round")
      if (name === "automations") {
        expect(outline.querySelector("circle")).toHaveAttribute("r", "10")
        expect(outline.querySelector("path")).toHaveAttribute(
          "d",
          "M12 6v6l-3 3"
        )
      }
      rerender(<SidebarRailIcon name={name} selected />)
      const solid = container.querySelector("svg")!
      expect(solid).toHaveClass("size-5")
      expect(solid).toHaveAttribute("viewBox", "0 0 24 24")
      expect(solid).toHaveAttribute("fill", "currentColor")
      expect(solid).toHaveAttribute("aria-hidden", "true")
    }
  )

  it("preserves the original conversation bubbles when switching to solid selection", () => {
    const { container } = render(
      <>
        <MessagesSquare />
        <SidebarRailIcon name="conversations" selected={false} />
        <SidebarRailIcon name="conversations" selected />
      </>
    )
    const [original, outline, solid] = container.querySelectorAll("svg")
    const paths = (icon: Element) =>
      Array.from(icon.querySelectorAll("path"), (path) =>
        path.getAttribute("d")
      )
    expect(paths(outline)).toEqual(paths(original))
    expect(solid.querySelector("path")).toHaveAttribute(
      "d",
      original.querySelector("path")!.getAttribute("d")
    )
    expect(outline).toHaveAttribute("fill", "none")
    expect(solid).toHaveAttribute("fill", "currentColor")
  })

  it("renders thin decorative compose, clock and task drawings", () => {
    const { container } = render(
      <>
        <SidebarNavigationIcon name="compose" />
        <SidebarNavigationIcon name="clock" />
        <SidebarNavigationIcon name="tasks" />
      </>
    )
    const icons = container.querySelectorAll("svg")
    expect(icons).toHaveLength(3)
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
    expect(sidebar).toContain('icon="tasks"')
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
