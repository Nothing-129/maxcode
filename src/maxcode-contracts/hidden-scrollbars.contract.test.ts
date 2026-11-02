import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8")

describe("MaxCode contract: hidden keep-alive scrollbars", () => {
  it("hides rails even when OverlayScrollbars explicitly makes them visible", () => {
    const rule = css.match(
      /\.conversation-tab-hidden \.os-scrollbar\s*\{([^}]+)\}/
    )?.[1]

    // The library's visible/interaction rules override inherited visibility.
    // Hiding only the tab, or suppressing transitions, does not hide its rails.
    expect(rule).toMatch(/visibility:\s*hidden\s*!important/)
    expect(rule).toMatch(/pointer-events:\s*none\s*!important/)
  })
})
