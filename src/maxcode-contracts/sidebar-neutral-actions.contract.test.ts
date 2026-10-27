import { describe, expect, it } from "vitest"
import postcss from "postcss"
import { source } from "./contract-source"

const stylesheet = postcss.parse(source("src/app/globals.css"))

describe("neutral sidebar action backgrounds", () => {
  it.each([false, true])("restores the original surfaces (dark=%s)", (dark) => {
    for (const theme of [null, "neutral"]) {
      const doc = document.implementation.createHTMLDocument()
      const root = doc.documentElement
      if (theme) root.dataset.theme = theme
      root.className = dark ? "dark" : "light"
      const actions = doc.createElement("div")
      actions.setAttribute("data-sidebar-actions", "")
      doc.body.append(actions)
      const tokens: Record<string, string> = {}
      stylesheet.walkRules((rule) => {
        if (!rule.selector.includes("[data-sidebar-actions]")) return
        if (!actions.matches(rule.selector)) return
        rule.walkDecls((decl) => {
          tokens[decl.prop] = decl.value
        })
      })
      expect(tokens["--sidebar-accent"]).toBe(dark ? "#2a2a2a" : "#ececec")
      expect(tokens["--sidebar-primary"]).toBe(dark ? "#ffffff" : "#0d0d0d")
      expect(tokens["--primary"]).toBeUndefined()
    }
  })

  it("uses the scoped tokens for default, hover and selected buttons", () => {
    const code = source("src/components/layout/sidebar.tsx")
    expect(code).toContain("data-sidebar-actions")
    expect(code).toContain("bg-sidebar-accent/35")
    expect(code).toContain("hover:bg-sidebar-accent")
    expect(code).toContain('active && "bg-sidebar-primary/10"')
  })
})
