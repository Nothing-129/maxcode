import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

/** Hide only insertion gaps after projected file atoms; retain their text data. */
export const FileAttachmentLayout = Extension.create({
  name: "fileAttachmentLayout",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isTextblock) return true
              let afterFile = false
              node.forEach((child, offset) => {
                if (afterFile && child.isText) {
                  const gap = child.text?.match(/^\s+/)?.[0]
                  if (gap)
                    decorations.push(
                      Decoration.inline(
                        pos + 1 + offset,
                        pos + 1 + offset + gap.length,
                        { class: "codeg-file-insertion-gap" }
                      )
                    )
                }
                afterFile =
                  child.type.name === "reference" &&
                  child.attrs.refType === "file"
              })
              return false
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
