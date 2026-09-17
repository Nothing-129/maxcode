import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: subtle sidebar seam", () => {
  it("uses one separator while preserving resize and focus feedback", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toContain("data-sidebar-seam")
    expect(layout).not.toContain("ws-surface-sidebar border-r")
    expect(layout).toContain("disabled={!sidebarOpen}")

    const css = source("src/app/globals.css")
    expect(css).toMatch(/\[data-sidebar-seam\]::before\s*\{\s*opacity: 0\.25;/)
    expect(css).toContain("opacity 150ms ease-out")
    for (const state of ["hover", "drag"]) {
      expect(css).toContain(
        `[data-sidebar-seam][data-resize-handle-state="${state}"]::before`
      )
    }
    expect(css).toMatch(
      /\[data-sidebar-seam\]:focus-visible::before\s*\{\s*opacity: 1;/
    )
  })
})
