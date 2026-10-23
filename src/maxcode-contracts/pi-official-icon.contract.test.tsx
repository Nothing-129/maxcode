import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentIcon } from "@/components/agent-icon"

describe("Pi official brand icon", () => {
  it("renders the pi.dev three-color SVG without the old black plate", () => {
    // https://pi.dev/logo-auto.svg, also used in farion1231/cc-switch
    const { container } = render(
      <AgentIcon agentType="pi" className="size-4 text-muted-foreground" />
    )
    const svg = container.querySelector("svg")
    expect(svg).toHaveAttribute("viewBox", "0 0 800 800")
    expect(svg?.querySelector("title")?.textContent).toBe("Pi")
    expect(
      Array.from(svg?.querySelectorAll("path") ?? [], (path) => ({
        fill: path.getAttribute("fill"),
        d: path.getAttribute("d"),
      }))
    ).toEqual([
      {
        fill: "#F09082",
        d: "M165.29 165.29H517.36V400H400V282.65H165.29Z",
      },
      {
        fill: "#4D9ABF",
        d: "M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z",
      },
      {
        fill: "#F1BE58",
        d: "M517.36 400H634.72V634.72H517.36Z",
      },
    ])
    expect(svg?.querySelector("rect, image, g[transform]")).toBeNull()
    expect(svg).toHaveAttribute("width", "100%")
    expect(svg).toHaveAttribute("height", "100%")
    expect(container.firstChild).toHaveClass("size-4")
  })
})
