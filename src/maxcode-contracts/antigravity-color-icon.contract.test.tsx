import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentIcon } from "@/components/agent-icon"
import { source } from "./contract-source"

describe("Antigravity official color icon", () => {
  it("uses the local full-color mark even in muted contexts", () => {
    const { container } = render(
      <AgentIcon
        agentType="antigravity"
        className="size-4 text-muted-foreground"
      />
    )
    const icon = container.querySelector("img")
    expect(icon).toHaveAttribute("src", "/agent-icons/antigravity.svg")
    expect(icon).toHaveAttribute("alt", "Google Antigravity")
    expect(icon).toHaveStyle({ width: "100%", height: "100%" })
    expect(container.firstChild).toHaveClass("size-4")

    // Official SVG from https://www.antigravity.google/press, kept offline.
    const svg = new DOMParser().parseFromString(
      source("public/agent-icons/antigravity.svg"),
      "image/svg+xml"
    )
    expect(svg.querySelector("parsererror")).toBeNull()
    expect(svg.documentElement.getAttribute("viewBox")).toBe("0 0 180 180")
    for (const color of ["#3186FF", "#FC413D", "#00B95C", "#FBBC04"]) {
      expect(svg.querySelector(`[fill="${color}"]`)).not.toBeNull()
    }
    expect(svg.querySelector('[fill="currentColor"]')).toBeNull()
    expect(svg.querySelector("mask")).not.toBeNull()
    expect(svg.querySelector("feGaussianBlur")).not.toBeNull()
    for (const element of svg.querySelectorAll("[mask], [filter]")) {
      const reference =
        element.getAttribute("mask") ?? element.getAttribute("filter")
      const id = reference?.match(/^url\(#(.+)\)$/)?.[1]
      expect(id).toBeTruthy()
      expect(svg.getElementById(id!)).not.toBeNull()
    }
  })
})
