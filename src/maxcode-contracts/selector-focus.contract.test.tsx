import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { InputModalityInit } from "@/components/input-modality-init"
import { source } from "./contract-source"

afterEach(cleanup)

describe("MaxCode contract: selector focus after pointer selection", () => {
  it("keeps restored focus without switching pointer input to keyboard", () => {
    render(<InputModalityInit />)
    const trigger = document.createElement("button")
    const menuOption = document.createElement("button")
    document.body.append(trigger, menuOption)
    try {
      // The menu may live in a portal outside the composer.
      fireEvent.keyDown(document, { key: "Tab" })
      fireEvent.pointerDown(menuOption, { pointerType: "mouse" })
      trigger.focus()
      expect(document.activeElement).toBe(trigger)
      expect(document.documentElement.dataset.inputModality).toBe("pointer")
      fireEvent.keyDown(trigger, { key: "Tab" })
      expect(document.documentElement.dataset.inputModality).toBe("keyboard")
      fireEvent.pointerDown(menuOption, { pointerType: "touch" })
      expect(document.documentElement.dataset.inputModality).toBe("pointer")
    } finally {
      trigger.remove()
      menuOption.remove()
    }
  })

  it("cleans up listeners and does not treat modifier shortcuts as navigation", () => {
    const view = render(<InputModalityInit />)
    fireEvent.pointerDown(document)
    fireEvent.keyDown(document, { key: "c", metaKey: true })
    expect(document.documentElement.dataset.inputModality).toBe("pointer")
    view.unmount()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.documentElement.dataset.inputModality).toBeUndefined()
  })

  it("limits suppression to pointer-focused selectors, not all buttons", () => {
    expect(source("src/app/layout.tsx")).toContain("<InputModalityInit />")
    expect(source("src/components/chat/selector-tooltip.tsx")).toContain(
      'data-selector-control=""'
    )
    expect(source("src/app/globals.css")).toContain(
      'html[data-input-modality="pointer"] [data-selector-control]:focus-visible'
    )
    expect(source("src/components/ui/button.tsx")).toContain(
      "focus-visible:ring-[3px]"
    )
  })
})
