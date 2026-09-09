import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode composer typography", () => {
  it("softens placeholder text without fading the typed message", () => {
    const css = source("src/app/globals.css")
    const placeholder = css.match(
      /\.codeg-composer \.ProseMirror p\.is-editor-empty:first-child::before\s*\{([^}]+)\}/
    )?.[1]

    expect(placeholder).toContain(
      "color: color-mix(in srgb, var(--muted-foreground) 65%, transparent)"
    )
  })

  it("matches the reference's medium 14px text instead of thin regular text", () => {
    const css = source("src/app/globals.css")
    const editor = css.match(
      /\.codeg-composer \.ProseMirror\s*\{([^}]+)\}/
    )?.[1]

    expect(editor).toMatch(
      /-apple-system-body,\s*ui-sans-serif,\s*-apple-system/
    )
    expect(editor).not.toContain("var(--font-sans)")
    expect(editor).toContain("color: #1a1c1e")
    expect(editor).toContain("font-size: 0.875rem")
    expect(editor).toContain("font-weight: 500")
    expect(editor).not.toContain("font-weight: 400;")
    expect(editor).toContain("line-height: 1.5;")
    expect(editor).not.toContain("--chat-font-size")
    expect(css).toMatch(
      /\.dark \.codeg-composer \.ProseMirror\s*\{\s*color: var\(--foreground\);/
    )
  })
})
