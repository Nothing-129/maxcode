import { createRef, useState } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"
import { source } from "./contract-source"

afterEach(async () => {
  cleanup()
  // Tiptap defers destruction by one tick; finish it before jsdom tears down.
  await new Promise((resolve) => setTimeout(resolve, 10))
})

async function mount({ text = true, disabled = false } = {}) {
  const ref = createRef<RichComposerHandle>()
  function Composer() {
    const [images, setImages] = useState(["one", "two"])
    return (
      <RichComposer
        ref={ref}
        disabled={disabled}
        onDeleteSelectedAttachments={() => setImages([])}
        attachmentContent={images.map((id) => (
          <div key={id} data-attachment-tile={id}>
            <div data-image-actions="">{id}.png</div>
          </div>
        ))}
      />
    )
  }
  const result = render(<Composer />)
  await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
  const editor = ref.current!.getEditor()!
  if (text) {
    act(() => {
      editor.commands.insertReference({
        refType: "file",
        id: "/tmp/report.json",
        label: "report.json",
        uri: "file:///tmp/report.json",
        meta: { fileKind: "file" },
      })
      editor.commands.insertContent(" inspect these")
    })
  }
  return { ...result, editor }
}

describe("composer images participate in select-all deletion", () => {
  it.each(["Backspace", "Delete"])(
    "deletes images, files and text together with %s",
    async (key) => {
      const { container, editor } = await mount()
      fireEvent.keyDown(editor.view.dom, { key: "a", ctrlKey: true })
      expect(container.querySelector(".codeg-composer")).toHaveAttribute(
        "data-all-selected",
        "true"
      )
      fireEvent.keyDown(editor.view.dom, { key })
      await waitFor(() => {
        expect(container.querySelector("[data-attachment-tile]")).toBeNull()
        expect(container.querySelector("[data-editor-file-card]")).toBeNull()
      })
      expect(editor.isEmpty).toBe(true)
    }
  )

  it("also deletes images when the text document is empty", async () => {
    const { container, editor } = await mount({ text: false })
    act(() => {
      editor.commands.selectAll()
    })
    fireEvent.keyDown(editor.view.dom, { key: "Backspace" })
    expect(container.querySelector("[data-attachment-tile]")).toBeNull()
  })

  it("preserves images for partial selections and cancels their highlight when moving the caret", async () => {
    const { container, editor } = await mount()
    act(() => {
      editor.commands.selectAll()
      editor.commands.setTextSelection({ from: 3, to: 6 })
    })
    expect(container.querySelector(".codeg-composer")).not.toHaveAttribute(
      "data-all-selected"
    )
    fireEvent.keyDown(editor.view.dom, { key: "Backspace" })
    expect(container.querySelectorAll("[data-attachment-tile]")).toHaveLength(2)
  })

  it("leaves the selection to the IME during composition", async () => {
    const { container, editor } = await mount()
    act(() => editor.commands.selectAll())
    fireEvent.keyDown(editor.view.dom, {
      key: "Backspace",
      isComposing: true,
    })
    expect(container.querySelectorAll("[data-attachment-tile]")).toHaveLength(2)
  })

  it("supports mobile deletion through beforeinput", async () => {
    const { container, editor } = await mount()
    act(() => editor.commands.selectAll())
    fireEvent(
      editor.view.dom,
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "deleteContentBackward",
      })
    )
    expect(container.querySelector("[data-attachment-tile]")).toBeNull()
  })

  it("does not remove attachments from a disabled composer", async () => {
    const { container, editor } = await mount({ disabled: true })
    act(() => editor.commands.selectAll())
    fireEvent.keyDown(editor.view.dom, { key: "Backspace" })
    fireEvent(
      editor.view.dom,
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "deleteContentBackward",
      })
    )
    expect(container.querySelectorAll("[data-attachment-tile]")).toHaveLength(2)
  })

  it("connects both composer hosts and paints selected thumbnails", () => {
    for (const path of [
      "src/components/chat/message-input.tsx",
      "src/components/tasks/task-message-composer.tsx",
    ]) {
      expect(source(path)).toContain("onDeleteSelectedAttachments=")
    }
    expect(source("src/app/globals.css")).toContain(
      '.codeg-composer[data-all-selected="true"] [data-attachment-tile] [data-image-actions]'
    )
  })
})
