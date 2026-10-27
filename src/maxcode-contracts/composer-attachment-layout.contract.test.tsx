import { createRef, type ReactNode } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"
import type { ReferenceAttrs } from "@/components/chat/composer/types"

afterEach(cleanup)

function file(name: string): ReferenceAttrs {
  return {
    refType: "file",
    id: `/tmp/${name}`,
    label: name,
    uri: `file:///tmp/${name}`,
    meta: { fileKind: "file" },
  }
}

async function mount(attachmentContent?: ReactNode) {
  const ref = createRef<RichComposerHandle>()
  const view = render(
    <RichComposer ref={ref} attachmentContent={attachmentContent} />
  )
  await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
  const editor = ref.current!.getEditor()!
  act(() => {
    editor.commands.insertReference(file("one.xlsx"))
    editor.commands.insertContent(" ")
    editor.commands.insertReference(file("two.wav"))
    editor.commands.insertContent(" 看下这些文件")
  })
  await screen.findByRole("button", { name: "Remove two.wav" })
  return { ...view, ref, editor }
}

describe("composer attachment and text separation", () => {
  it("keeps image attachments, file cards and text in document flow inside one scrollport", async () => {
    const { container, editor } = await mount(
      <div data-image-strip="">
        <button>Preview image</button>
      </div>
    )
    const scroll = container.querySelector(".codeg-composer-scroll")!
    const images = container.querySelector("[data-image-strip]")!
    const card = container.querySelector("[data-editor-file-card]")!
    const text = container.querySelector(".ProseMirror")!
    for (const element of [images, card, text]) {
      expect(scroll.contains(element)).toBe(true)
    }
    expect(
      images.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      card.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const preview = screen.getByRole("button", { name: "Preview image" })
    fireEvent.click(screen.getByRole("button", { name: "Remove one.xlsx" }))
    expect(screen.getByRole("button", { name: "Preview image" })).toBe(preview)
    expect(editor.getText()).toContain("看下这些文件")
  })

  it("projects files above the text without changing the document or prompt order", async () => {
    const { container, editor, ref } = await mount()
    const doc = editor.getJSON()
    const prompt = ref.current!.getText()
    const editing = container.querySelector(".ProseMirror")!
    const cards = container.querySelectorAll("[data-editor-file-card]")
    expect(cards).toHaveLength(2)
    cards.forEach((card) => expect(editing.contains(card)).toBe(false))
    expect(editing).toHaveTextContent("看下这些文件")
    expect(editing).not.toHaveTextContent("one.xlsx")
    expect(
      editing.querySelectorAll(
        '[data-composer-reference="file"][aria-hidden="true"]'
      )
    ).toHaveLength(2)
    expect(editing.querySelector(".codeg-file-insertion-gap")).not.toBeNull()
    act(() => {
      editor.commands.insertContent("，谢谢")
    })
    await waitFor(() => expect(ref.current!.getText()).toBe(`${prompt}，谢谢`))
    expect(editor.getJSON().content?.[0].content?.slice(0, 3)).toEqual(
      doc.content?.[0].content?.slice(0, 3)
    )
    expect(prompt).toBe(
      "[one.xlsx](file:///tmp/one.xlsx) [two.wav](file:///tmp/two.wav) 看下这些文件"
    )
  })

  it("removes only the chosen file at its current position and supports undo", async () => {
    const { editor, ref } = await mount()
    // Moving positions must not leave the remove button closing over stale offsets.
    act(() => {
      editor.commands.setTextSelection(1)
      editor.commands.insertContent("Before ")
    })
    await waitFor(() => expect(ref.current!.getText()).toMatch(/^Before /))
    const before = ref.current!.getText()
    fireEvent.click(screen.getByRole("button", { name: "Remove two.wav" }))
    await waitFor(() => expect(ref.current!.getText()).not.toContain("two.wav"))
    expect(ref.current!.getText()).toContain("one.xlsx")
    expect(ref.current!.getText()).toContain("Before ")
    expect(ref.current!.getText()).toContain("看下这些文件")
    expect(screen.queryByRole("button", { name: "Remove two.wav" })).toBeNull()
    act(() => {
      editor.commands.undo()
    })
    await waitFor(() => expect(ref.current!.getText()).toBe(before))
    expect(
      await screen.findByRole("button", { name: "Remove two.wav" })
    ).toBeEnabled()
  })

  it("shows document selection on the projected card", async () => {
    const { container, editor } = await mount()
    act(() => {
      editor.commands.setNodeSelection(1)
    })
    await waitFor(() =>
      expect(
        container.querySelector("[data-editor-file-card]")
      ).toHaveAttribute("data-selected", "true")
    )
  })
})
