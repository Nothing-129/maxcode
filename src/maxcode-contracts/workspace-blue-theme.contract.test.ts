import { describe, expect, it } from "vitest"
import postcss from "postcss"
import { source } from "./contract-source"

const stylesheet = postcss.parse(source("src/app/globals.css"))

function palette(theme: string | null, dark: boolean) {
  const root = document.implementation.createHTMLDocument().documentElement
  if (theme) root.dataset.theme = theme
  root.className = dark ? "dark" : "light"
  const tokens: Record<string, string> = {}
  stylesheet.walkRules((rule) => {
    // Only palette rules: utility selectors can contain Tailwind syntax.
    if (
      !rule.nodes.some(
        (node) =>
          node.type === "decl" &&
          ["--primary", "--sidebar-primary"].includes(node.prop)
      )
    )
      return
    if (!root.matches(rule.selector)) return
    rule.walkDecls((decl) => {
      tokens[decl.prop] = decl.value
    })
  })
  return tokens
}

describe("default workspace blue actions", () => {
  it.each([false, true])(
    "shares Todo blue with root and portal inheritance (dark=%s)",
    (dark) => {
      for (const theme of [null, "neutral"]) {
        const tokens = palette(theme, dark)
        expect(tokens["--primary"]).toBe("#216ae4")
        expect(tokens["--primary-foreground"]).toBe("#ffffff")
        expect(tokens["--ring"]).toBe("#216ae4")
        expect(tokens["--sidebar-primary"]).toBe("#216ae4")
        expect(tokens["--sidebar-ring"]).toBe("#216ae4")
        expect(tokens["--accent"]).toBe(
          "color-mix(in srgb, #216ae4 12%, var(--background))"
        )
        expect(tokens["--background"]).toBe(dark ? "#212121" : "#ffffff")
        expect(tokens["--destructive"]).not.toBe("#216ae4")
      }
    }
  )

  it.each([false, true])(
    "preserves explicitly selected palettes (dark=%s)",
    (dark) => {
      expect(palette("hbuilderx", dark)["--primary"]).not.toBe("#216ae4")
      expect(palette("rose", dark)["--primary"]).not.toBe("#216ae4")
    }
  )

  it("keeps checked settings switches on the shared action color", () => {
    const colors: string[] = []
    stylesheet.walkRules((rule) => {
      if (
        rule.selector !==
        '[data-settings-surface] [data-slot="switch"][data-state="checked"]'
      )
        return
      rule.walkDecls("background", (decl) => {
        colors.push(decl.value)
      })
    })
    expect(colors).toEqual(["var(--primary)"])
  })
})
