import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { createRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"
import { useComposerChromeFocus } from "@/components/chat/composer/use-composer-chrome-focus"
import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog"

const draft = "one\ntwo\nthree\nfour"

afterEach(cleanup)

describe("MaxCode: image preview must not move the multiline composer caret", () => {
  it.each(["mouse", "touch", "pen", "legacy-mouse"])(
    "keeps line four after a %s preview interaction and inserts line five",
    async (pointerType) => {
      const ref = createRef<RichComposerHandle>()
      function Harness() {
        const chrome = useComposerChromeFocus(ref)
        const [open, setOpen] = useState(false)
        return (
          <div {...chrome}>
            <button onClick={() => setOpen(true)}>Preview attachment</button>
            <RichComposer ref={ref} defaultText={draft} />
            <ImagePreviewDialog
              src="data:image/png;base64,aW1hZ2U="
              alt="Attachment preview"
              open={open}
              onOpenChange={setOpen}
            />
          </div>
        )
      }
      render(<Harness />)
      await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
      const editor = ref.current!.getEditor()!
      const end = editor.state.doc.content.size - 1
      act(() => editor.commands.setTextSelection(end))
      // A preview point can map to line two in the editor behind it. If the
      // portaled event is mistaken for chrome, it overwrites the saved caret.
      const mapPoint = vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
        pos: 5,
        inside: 0,
      })
      fireEvent.click(
        screen.getByRole("button", { name: "Preview attachment" })
      )
      const image = screen.getByRole("img", { name: "Attachment preview" })
      const dialog = screen.getByRole("dialog")
      const press = (target: Element) => {
        if (pointerType === "legacy-mouse") {
          fireEvent.mouseDown(target)
        } else if (pointerType === "mouse") {
          const event = new Event("pointerdown", {
            bubbles: true,
            cancelable: true,
          })
          Object.defineProperty(event, "pointerType", { value: "mouse" })
          fireEvent(target, event)
        } else {
          const event = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          })
          Object.defineProperty(event, "pointerType", { value: pointerType })
          fireEvent(target, event)
        }
      }
      press(image)
      expect(editor.state.selection.from).toBe(end)
      press(dialog)
      fireEvent.click(dialog)
      expect(mapPoint).not.toHaveBeenCalled()
      expect(editor.state.selection.from).toBe(end)
      fireEvent.keyDown(editor.view.dom, { key: "Enter", shiftKey: true })
      expect(ref.current!.getText()).toBe(`${draft}\n`)
    }
  )
})
