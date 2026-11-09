import { TextSelection } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"

/** Keep Up on a leading blank line out of ProseMirror's DOM buffer handling. */
export function moveToLeadingEmptyLine(
  view: EditorView,
  event: KeyboardEvent
): boolean {
  if (
    event.key !== "ArrowUp" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !view.editable
  ) {
    return false
  }
  const { selection } = view.state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const { $head } = selection
  if (!$head.parent.isTextblock || $head.parentOffset === 0) return false

  // Only intervene immediately after a run of hard breaks at the block start.
  // Wrapped lines and text before the caret keep native vertical navigation.
  let offset = 0
  for (let i = 0; offset < $head.parentOffset; i++) {
    const node = $head.parent.child(i)
    if (node.type.name !== "hardBreak") return false
    offset += node.nodeSize
  }
  const head = $head.pos - $head.nodeBefore!.nodeSize
  // ProseMirror can skip its leading separator image and cache the old DOM
  // selection, then restore it after the browser has moved Up. Dispatch the
  // blank-line position directly so its state and the native caret agree.
  view.dispatch(
    view.state.tr
      .setSelection(
        TextSelection.create(
          view.state.doc,
          event.shiftKey ? selection.anchor : head,
          head
        )
      )
      .scrollIntoView()
  )
  return true
}
