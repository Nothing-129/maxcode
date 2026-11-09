import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"

afterEach(cleanup)

async function mount() {
  const ref = createRef<RichComposerHandle>()
  const history = vi.fn(() => true)
  const change = vi.fn()
  render(
    <RichComposer
      ref={ref}
      defaultText="hello"
      onHistoryKeyDown={history}
      onChange={change}
    />
  )
  await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
  return { ref, editor: ref.current!.getEditor()!, history, change }
}

describe("MaxCode: caret navigation into leading empty composer lines", () => {
  it("moves Up after inserting a newline before existing text, without recalling history", async () => {
    const { ref, editor, history, change } = await mount()
    act(() => editor.commands.setTextSelection(1))
    fireEvent.keyDown(editor.view.dom, { key: "Enter", shiftKey: true })
    expect(ref.current!.getText()).toBe("\nhello")
    expect(editor.state.selection.from).toBe(2)
    change.mockClear()

    expect(fireEvent.keyDown(editor.view.dom, { key: "ArrowUp" })).toBe(false)
    expect(editor.state.selection.from).toBe(1)
    expect(history).not.toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
    act(() => editor.commands.insertContent("first"))
    expect(ref.current!.getText()).toBe("first\nhello")
  })

  it("moves through consecutive leading empty lines before recalling history at the document edge", async () => {
    const { ref, editor, history } = await mount()
    act(() => {
      ref.current!.setText("\n\nhello")
      editor.commands.setTextSelection(3)
    })
    fireEvent.keyDown(editor.view.dom, { key: "ArrowUp" })
    expect(editor.state.selection.from).toBe(2)
    fireEvent.keyDown(editor.view.dom, { key: "ArrowUp" })
    expect(editor.state.selection.from).toBe(1)
    expect(history).not.toHaveBeenCalled()
    fireEvent.keyDown(editor.view.dom, { key: "ArrowUp" })
    expect(history).toHaveBeenCalledWith("older", expect.any(KeyboardEvent))
  })

  it("supports Shift+Up without editing the newline", async () => {
    const { ref, editor, history } = await mount()
    act(() => {
      ref.current!.setText("\nhello")
      editor.commands.setTextSelection(2)
    })
    fireEvent.keyDown(editor.view.dom, { key: "ArrowUp", shiftKey: true })
    expect(editor.state.selection.anchor).toBe(2)
    expect(editor.state.selection.head).toBe(1)
    expect(ref.current!.getText()).toBe("\nhello")
    expect(history).not.toHaveBeenCalled()
  })

  it.each([
    ["hello\nworld", 7, {}],
    ["\nhello", 4, {}],
    ["\nhello", 2, { altKey: true }],
    ["\nhello", 2, { ctrlKey: true }],
    ["\nhello", 2, { metaKey: true }],
    ["\nhello", 2, { isComposing: true }],
  ])(
    "keeps native navigation for %j at %i with %j",
    async (text, pos, keys) => {
      const { ref, editor } = await mount()
      act(() => {
        ref.current!.setText(text)
        editor.commands.setTextSelection(pos)
      })
      expect(
        fireEvent.keyDown(editor.view.dom, { key: "ArrowUp", ...keys })
      ).toBe(true)
    }
  )
})
