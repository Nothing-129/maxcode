import postcss from "postcss"
import { createElement } from "react"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/ai-elements/link-safety", () => ({
  useStreamdownLinkSafety: () => ({ enabled: false }),
}))

import { MessageResponse } from "@/components/ai-elements/message"

import { source } from "./contract-source"

const css = postcss.parse(source("src/app/globals.css"))
const card = '.chat-message-text [data-streamdown="code-block"]'
const header = '.chat-message-text [data-streamdown="code-block-header"]'
const actions = '.chat-message-text [data-streamdown="code-block-actions"]'
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
    // Exercise the real dependency DOM: Streamdown 2.7 moved the action buttons
    // out of the header, which otherwise leaves correct-looking source checks
    // while the user's actual buttons silently lose MaxCode's sizing.
    const { container } = render(
      createElement(
        "div",
        { className: "chat-message-text" },
        createElement(MessageResponse, null, "```ts\nconst x = 1\n```")
      )
    )
    const buttons = container.querySelectorAll(`${actions} button`)
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect(button.querySelector("svg")).not.toBeNull()
    }
    expect(declarations(header)["font-size"]).toBe("0.75rem")
    expect(declarations(`${actions} button svg`)).toMatchObject({
      width: "0.75rem",
      height: "0.75rem",
    })
    expect(declarations(`${actions} button`)).toMatchObject({
      "min-width": "1.75rem",
      "min-height": "1.75rem",
    })
  })
})
