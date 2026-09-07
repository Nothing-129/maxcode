import { describe, expect, it } from "vitest"
import postcss from "postcss"

import { source } from "./contract-source"

describe("MaxCode contract: GPT-matched workspace surfaces", () => {
  it.each(["neutral", null])(
    "rejects competing light surface declarations for theme %s",
    (theme) => {
      const root = document.implementation.createHTMLDocument().documentElement
      root.className = "light"
      if (theme) root.setAttribute("data-theme", theme)

      // Inspect every matching rule, not just the preset block: a later or
      // more specific html selector must not silently replace these tokens.
      const declarations: Record<string, string[]> = {
        "--background": [],
        "--sidebar": [],
      }
      postcss.parse(source("src/app/globals.css")).walkRules((rule) => {
        if (
          !rule.nodes.some(
            (node) => node.type === "decl" && node.prop in declarations
          )
        ) {
          return
        }
        if (!root.matches(rule.selector)) return
        rule.walkDecls((decl) => {
          if (decl.prop in declarations) {
            declarations[decl.prop].push(decl.value.toLowerCase())
          }
        })
      })

      expect(new Set(declarations["--background"])).toEqual(
        new Set(["#ffffff"])
      )
      expect(new Set(declarations["--sidebar"])).toEqual(new Set(["#fcfcfc"]))
    }
  )

  // Sampled from the Codex desktop half of the user's 2026-09-07 comparison:
  // dominant sidebar RGB = 252,252,252; main canvas RGB = 255,255,255.
  it("matches the desktop reference's white canvas and near-white sidebar", () => {
    const globals = source("src/app/globals.css")

    const neutral = globals.match(
      /\[data-theme="neutral"\] \{(?<tokens>[\s\S]*?)\n\}/
    )?.groups?.tokens
    const fallback = globals.match(
      /:root:not\(\[data-theme\]\) \{(?<tokens>[\s\S]*?)\n\}/
    )?.groups?.tokens

    expect(neutral).toContain("--background: #ffffff;")
    expect(neutral).toContain("--sidebar: #fcfcfc;")
    expect(fallback).toContain("--background: #ffffff;")
    expect(fallback).toContain("--sidebar: #fcfcfc;")
  })
  it("softens only neutral light composer paint without changing layout", () => {
    const rules: Record<string, Record<string, string>> = {}
    postcss.parse(source("src/app/globals.css")).walkRules((rule) => {
      if (!rule.selector.includes(':root:is([data-theme="neutral"]')) return
      const declarations: Record<string, string> = {}
      rule.walkDecls((decl) => {
        declarations[decl.prop] = decl.value.replace(/\s+/g, " ")
      })
      rules[rule.selector.replace(/\s+/g, " ")] = declarations
    })
    const scope =
      ':root:is([data-theme="neutral"], :not([data-theme])):not(.dark)'
    expect(rules[`${scope} .codeg-composer-chrome`]).toEqual({
      "border-color": "rgb(0 0 0 / 6%)",
    })
    expect(rules[`${scope} .maxcode-composer-shadow`]).toEqual({
      "box-shadow": "0 2px 6px rgb(0 0 0 / 2%), 0 8px 32px rgb(0 0 0 / 3%)",
    })
    expect(source("src/components/chat/composer/composer-chrome.ts")).toContain(
      "maxcode-composer-shadow"
    )
  })
})
