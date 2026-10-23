import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: readable Markdown table columns", () => {
  const css = source("src/app/globals.css")
  const rule = (name: string) =>
    css.match(new RegExp(`\\[data-streamdown="${name}"\\] \\{([^}]+)\\}`))?.[1]

  it("lets inline and fullscreen tables grow beyond a narrow viewport", () => {
    expect(rule("table")).toContain("width: max-content")
    expect(rule("table")).toContain("min-width: 100%")
    expect(rule("table")).toContain("max-width: none")
  })

  it("bounds long prose and unbroken URLs while allowing body text to wrap", () => {
    expect(css).toContain(
      '[data-streamdown="table-header-cell"],\n[data-streamdown="table-cell"]'
    )
    expect(rule("table-cell")).toContain("max-width: clamp(12rem, 60vw, 32rem)")
    expect(rule("table-cell")).toContain("white-space: normal")
    expect(rule("table-cell")).toContain("overflow-wrap: anywhere")
  })
})
