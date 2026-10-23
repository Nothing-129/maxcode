import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentIcon } from "./agent-icon"

describe("AgentIcon", () => {
  it("renders the upstream ZCode logo with its app icon plate", () => {
    const { container } = render(<AgentIcon agentType="zcode" />)
    const svg = container.querySelector("svg")
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute("viewBox", "-1 -1 26 26")
    expect(svg?.querySelector("title")?.textContent).toBe("ZCode")
    expect(svg?.querySelector("linearGradient")).not.toBeNull()
  })
})
