import { readFileSync } from "node:fs"
import { Editor } from "@tiptap/core"
import { afterEach, describe, expect, it } from "vitest"
import { buildComposerExtensions } from "@/components/chat/composer/editor-config"
import { inactiveSelectionDecorations } from "@/components/chat/composer/inactive-selection"

let editor: Editor | undefined

afterEach(() => editor?.destroy())

describe("MaxCode: clean empty composer selection", () => {
  it("clears selection paint after deleting all text, including after blur and reselecting all", () => {
    editor = new Editor({
      extensions: buildComposerExtensions({ placeholder: "Ask anything" }),
      content: "hello world",
    })
    editor.commands.selectAll()
    expect(inactiveSelectionDecorations(editor.state, false)).not.toBeNull()
    editor.commands.deleteSelection()
    expect(editor.isEmpty).toBe(true)
    expect(editor.state.selection.empty).toBe(true)
    expect(inactiveSelectionDecorations(editor.state, false)).toBeNull()
    expect(editor.view.dom.querySelector(".is-editor-empty")).not.toBeNull()
    editor.commands.undo()
    expect(editor.getText()).toBe("hello world")
    editor.commands.redo()
    expect(editor.isEmpty).toBe(true)
    expect(editor.state.selection.empty).toBe(true)
    editor.commands.selectAll()
    expect(inactiveSelectionDecorations(editor.state, false)).toBeNull()
    editor.commands.insertContent("new text")
    editor.commands.selectAll()
    expect(inactiveSelectionDecorations(editor.state, false)).not.toBeNull()
    expect(inactiveSelectionDecorations(editor.state, true)).toBeNull()
  })

  it("suppresses native selection only on the empty paragraph and excludes the placeholder", () => {
    const css = readFileSync("src/app/globals.css", "utf8")
    expect(css).toMatch(
      /\.codeg-composer \.ProseMirror p\.is-editor-empty::selection,\s*\.codeg-composer \.ProseMirror p\.is-editor-empty br::selection\s*\{\s*background-color: transparent;/
    )
    expect(css).toMatch(
      /p\.is-editor-empty:first-child::before\s*\{\s*user-select: none;\s*-webkit-user-select: none;/
    )
    expect(css).not.toMatch(
      /\.ProseMirror\s*::selection\s*\{\s*background-color: transparent;/
    )
  })
})
