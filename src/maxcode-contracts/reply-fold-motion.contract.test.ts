import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: elapsed-header disclosure feedback", () => {
  const css = source("src/app/globals.css")
  const fold = css.slice(
    css.indexOf(".reply-fold-body {"),
    css.indexOf("/* Welcome-page quick actions")
  )

  it("animates grid height on deliberate toggles with finite exit presence", () => {
    expect(fold).toContain('data-state="open"].reply-fold-enter')
    expect(fold).toContain("reply-fold-open 320ms")
    expect(fold).toContain("reply-fold-close 220ms")
    expect(fold).toContain("grid-template-rows: 0fr")
    expect(fold).toContain("grid-template-rows: 1fr")
    expect(fold).toContain("min-height: 0")
    expect(fold).toContain("overflow: hidden")
  })

  it("retains visible feedback without spatial movement in reduced motion", () => {
    const reduced = fold.slice(fold.indexOf("@media"))
    expect(reduced).toContain("maxcode-fade-in 120ms")
    expect(reduced).toContain("maxcode-fade-out 100ms")
    expect(reduced).not.toContain("animation: none")
    expect(reduced).not.toContain("animation: reply-fold")
  })
})
