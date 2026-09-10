import { describe, expect, it } from "vitest"
import postcss from "postcss"
import { source } from "./contract-source"

describe("Token usage data colors", () => {
  it.each([null, "neutral", "zinc", "slate", "stone", "gray"])(
    "keeps cache and fresh tokens colorful in theme %s",
    (theme) => {
      for (const dark of [false, true]) {
        const doc = document.implementation.createHTMLDocument()
        const root = doc.documentElement
        if (theme) root.dataset.theme = theme
        root.classList.toggle("dark", dark)
        const page = doc.createElement("div")
        page.className = "tu-viz"
        doc.body.append(page)
        const palette: Record<string, string> = {}
        postcss.parse(source("src/app/globals.css")).walkRules((rule) => {
          if (!rule.selector.includes(".tu-viz")) return
          // Palette overrides must stay scoped to the dashboard.
          expect(root.matches(rule.selector)).toBe(false)
          if (!page.matches(rule.selector)) return
          rule.walkDecls((decl) => {
            palette[decl.prop] = decl.value
          })
        })
        expect(palette["--tu-accent"]).toBe(dark ? "#60a5fa" : "#3b82f6")
        expect(palette["--tu-ink"]).toBe(dark ? "#a78bfa" : "#8b5cf6")
        expect(palette["--tu-accent-soft"]).toContain("var(--card)")
        for (let level = 1; level <= 7; level++) {
          expect(palette[`--tu-seq-${level}`]).toContain("var(--tu-accent)")
        }
      }
    }
  )
})
