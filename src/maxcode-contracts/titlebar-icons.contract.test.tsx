import { render } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  DesktopChromeIcon,
  desktopChromeButtonClassName,
  type DesktopChromeIconName,
} from "@/components/layout/desktop-chrome-icon"

const source = (path: string) =>
  readFileSync(`src/components/${path}.tsx`, "utf8")

describe("unified titlebar icons", () => {
  it.each<DesktopChromeIconName>([
    "search",
    "locate",
    "settings",
    "more",
    "sidebar",
    "compose",
    "panel",
  ])("renders %s with the same optical grid and stroke", (name) => {
    const { container } = render(<DesktopChromeIcon name={name} />)
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("viewBox")).toBe("0 0 20 20")
    expect(svg.getAttribute("stroke-width")).toBe("1.5")
    expect(svg.classList.contains("size-4.5")).toBe(true)
    expect(svg.getAttribute("aria-hidden")).toBe("true")
    expect(svg.querySelector("path, circle, rect")).not.toBeNull()
  })

  it("shares button styling and aligns desktop sidebar tools to the 48px header", () => {
    expect(desktopChromeButtonClassName).toContain("size-8")
    expect(desktopChromeButtonClassName).toContain("text-muted-foreground")
    for (const path of [
      "layout/sidebar",
      "layout/left-edge-chrome",
      "layout/right-edge-chrome",
      "conversations/conversation-detail-header",
    ]) {
      expect(source(path)).toContain("desktopChromeButtonClassName")
    }
    expect(source("layout/sidebar")).toContain('"h-12 pl-0"')
    expect(source("layout/sidebar")).toContain('isMobile && "size-11"')
    expect(source("conversations/conversation-detail-header")).not.toContain(
      "[&_svg]:size-6"
    )
  })
})
