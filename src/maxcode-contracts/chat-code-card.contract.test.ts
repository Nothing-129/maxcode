import postcss from "postcss"
import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

const css = postcss.parse(source("src/app/globals.css"))
const card = '.chat-message-text [data-streamdown="code-block"]'
const header = '.chat-message-text [data-streamdown="code-block-header"]'
const body = `${card} [data-streamdown="code-block-body"]`

function declarations(selector: string) {
  const values: Record<string, string> = {}
  css.walkRules((rule) => {
    if (rule.selector.replace(/\s+/g, " ") !== selector) return
    rule.walkDecls((decl) => {
      values[decl.prop] = decl.value + (decl.important ? " !important" : "")
    })
  })
  return values
}

describe("MaxCode contract: unified chat code cards", () => {
  it("uses one neutral card surface with no header/body partition", () => {
    expect(declarations(card)).toMatchObject({
      "background-color": "#f5f5f5",
      "border-radius": "1.25rem",
    })
    expect(declarations(header)).toMatchObject({
      "background-color": "transparent",
      border: "0",
    })
    // Must beat the Shiki background, including the system-dark fallback.
    expect(declarations(body)).toMatchObject({
      "background-color": "transparent !important",
      border: "0",
    })
    expect(declarations(`.dark ${card}`)["background-color"]).toBe("#242424")
  })

  it("keeps labels and icons small without shrinking action hit targets", () => {
    expect(declarations(header)["font-size"]).toBe("0.75rem")
    expect(declarations(`${header} button svg`)).toMatchObject({
      width: "0.75rem",
      height: "0.75rem",
    })
    expect(declarations(`${header} button`)).toMatchObject({
      "min-width": "1.75rem",
      "min-height": "1.75rem",
    })
  })
})
