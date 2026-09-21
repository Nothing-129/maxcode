import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentIcon } from "./agent-icon"

describe("AgentIcon", () => {
  it("renders the ZCode mark as a currentColor glyph pinned to the theme foreground", () => {
    const { container } = render(<AgentIcon agentType="zcode" />)
    const svg = container.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute("fill", "currentColor")
    expect(svg?.querySelector("title")?.textContent).toBe("ZCode")
    expect(svg?.querySelector("linearGradient")).toBeNull()
    expect(container.firstElementChild).toHaveClass("text-foreground")
  })
})
