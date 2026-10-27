import { describe, expect, it } from "vitest"
import postcss from "postcss"
import { source } from "./contract-source"

describe("neutral model picker hover", () => {
  it.each([false, true])("restores the neutral accent (dark=%s)", (dark) => {
    const doc = document.implementation.createHTMLDocument()
    doc.documentElement.dataset.theme = "neutral"
    doc.documentElement.className = dark ? "dark" : "light"
    const surface = doc.createElement("div")
    surface.setAttribute("data-neutral-model-surface", "")
    doc.body.append(surface)
    let accent = ""
    postcss.parse(source("src/app/globals.css")).walkRules((rule) => {
      if (!rule.selector.includes("[data-neutral-model-surface]")) return
      if (!surface.matches(rule.selector)) return
      rule.walkDecls("--accent", (decl) => {
        accent = decl.value
      })
    })
    expect(accent).toBe(dark ? "#2f2f2f" : "#ececec")
  })

  it.each(["model-option-picker", "session-config-selector"])(
    "scopes both the trigger and portal in %s",
    (component) => {
      const code = source(`src/components/chat/${component}.tsx`)
      expect(code.match(/data-neutral-model-surface/g)).toHaveLength(2)
    }
  )
})
