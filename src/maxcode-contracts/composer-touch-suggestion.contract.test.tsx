import { createRef } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AcceptPromptSuggestion } from "@/components/chat/composer/accept-prompt-suggestion"
import type { RichComposerHandle } from "@/components/chat/composer/rich-composer"
import { source } from "./contract-source"

afterEach(cleanup)

describe("desktop and touch composer suggestion adoption", () => {
  function mount(empty = true) {
    const editorRef = createRef<RichComposerHandle>()
    const setText = vi.fn()
    const focus = vi.fn()
    const isEmpty = vi.fn(() => empty)
    editorRef.current = {
      setText,
      focus,
      isEmpty,
    } as unknown as RichComposerHandle
    render(
      <AcceptPromptSuggestion
        editorRef={editorRef}
        suggestion="  允许，继续查  "
        label="采纳建议"
      />
    )
    return { setText, focus, isEmpty }
  }

  it("requires a separate click and fills the editor without submitting", () => {
    const { setText, focus } = mount()
    const button = screen.getByRole("button", { name: "采纳建议" })
    expect(button).toHaveAttribute("type", "button")
    expect(setText).not.toHaveBeenCalled()
    expect(button).toHaveClass("size-8")
    fireEvent.click(button)
    expect(setText).toHaveBeenCalledWith("允许，继续查")
    expect(focus).toHaveBeenCalledOnce()
  })

  it("rechecks the live document so a late tap cannot overwrite typing", () => {
    const { setText, focus, isEmpty } = mount()
    isEmpty.mockReturnValue(false)
    fireEvent.click(screen.getByRole("button", { name: "采纳建议" }))
    expect(setText).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
  })

  it("offers the icon on desktop and touch, separate from placeholder and send", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain(
      "const useTouchSuggestion = isMobile || isCoarsePointer"
    )
    expect(input).toMatch(/useTouchSuggestion\s*\? offeredSuggestion/)
    expect(input).toMatch(
      /\{offeredSuggestion && composerEmpty && \(\s*<AcceptPromptSuggestion/
    )
    expect(input).toMatch(
      /<AcceptPromptSuggestion[\s\S]*?\/>(?:\s*\)\})\s*\{actionButtons\}/
    )
    const button = source(
      "src/components/chat/composer/accept-prompt-suggestion.tsx"
    )
    expect(button).not.toContain("onSubmit")
    expect(button).not.toContain("handleSend")
  })
})
