import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DesktopChromeIcon } from "@/components/layout/desktop-chrome-icon"
import { source } from "./contract-source"

describe("MaxCode contract: desktop title bar icons", () => {
  it("uses decorative optical-size icons without extra keyboard stops", () => {
    const { container } = render(
      <>
        {(
          ["sidebar", "share", "more", "terminal", "panel", "settings"] as const
        ).map((name) => (
          <DesktopChromeIcon key={name} name={name} />
        ))}
      </>
    )
    const icons = container.querySelectorAll("svg")
    expect(icons).toHaveLength(6)
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true")
      expect(icon.getAttribute("focusable")).toBe("false")
      expect(icon.getAttribute("viewBox")).toBe("0 0 20 20")
      expect(icon.getAttribute("stroke-width")).toBe("1.25")
    }
    const dots = container.querySelectorAll(
      '[data-desktop-chrome-icon="more"] circle'
    )
    expect(Array.from(dots, (dot) => dot.getAttribute("cy"))).toEqual([
      "10",
      "10",
      "10",
    ])
  })

  it("keeps existing actions wired to the new header drawings", () => {
    const left = source("src/components/layout/left-edge-chrome.tsx")
    const right = source("src/components/layout/right-edge-chrome.tsx")
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    expect(left).toContain('DesktopChromeIcon name="sidebar"')
    expect(left).toContain("onClick={toggle}")
    expect(right).toContain("onClick={() => toggleTerminal()}")
    expect(right).toContain("onClick={toggleAuxPanel}")
    expect(right).toContain("onClick={handleOpenSettings}")
    expect(header).toContain("onSelect={handleShareOpen}")
    expect(header).toContain('DesktopChromeIcon name="share"')
    expect(header).toContain('DesktopChromeIcon name="more"')
  })
})
