"use client"

import type { Editor } from "@tiptap/core"
import type { ReactNode } from "react"
import { useEditorState } from "@tiptap/react"
import { AnimatePresence, motion, useIsPresent } from "motion/react"
import { X } from "lucide-react"
import { AttachmentTray } from "./attachment-tray"
import { ReferenceBadge } from "./badges/reference-badge"
import { useMediaQuery } from "@/hooks/use-media-query"
import type { ReferenceAttrs } from "./types"
import { ATTACHMENT_REMOVE_CLASS } from "./attachment-card"

interface FileEntry {
  key: string
  attrs: ReferenceAttrs
  pos: number
  size: number
  selected: boolean
  editable: boolean
}

function FileCardContent({
  file,
  editor,
  removeLabel,
}: {
  file: FileEntry
  editor: Editor | null
  removeLabel?: (name: string) => string
}) {
  const present = useIsPresent()
  return (
    <div inert={!present} aria-hidden={!present}>
      <ReferenceBadge
        data={file.attrs}
        appearance="composer-file"
        className="w-full max-w-none pr-7"
      />
      <button
        type="button"
        disabled={!file.editable || !present}
        className={ATTACHMENT_REMOVE_CLASS}
        aria-label={
          removeLabel?.(file.attrs.label || file.attrs.id) ??
          `Remove ${file.attrs.label || file.attrs.id}`
        }
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          editor
            ?.chain()
            .focus()
            .deleteRange({ from: file.pos, to: file.pos + file.size })
            .run()
        }
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/** A view of the document's file atoms; the document remains the source of truth. */
export function EditorFileAttachments({
  editor,
  removeLabel,
  children,
  attachmentsPresent = false,
}: {
  editor: Editor | null
  removeLabel?: (name: string) => string
  children?: ReactNode
  attachmentsPresent?: boolean
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)")
  const files =
    useEditorState({
      editor,
      selector: ({ editor }) => {
        const result: FileEntry[] = []
        if (!editor) return result
        const counts = new Map<string, number>()
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== "reference" || node.attrs.refType !== "file")
            return
          const attrs = node.attrs as ReferenceAttrs
          const identity = attrs.uri || attrs.id
          const count = counts.get(identity) ?? 0
          counts.set(identity, count + 1)
          result.push({
            key: `${identity}:${count}`,
            attrs,
            pos,
            size: node.nodeSize,
            editable: editor.isEditable,
            selected:
              editor.state.selection.from <= pos &&
              editor.state.selection.to >= pos + node.nodeSize,
          })
        })
        return result
      },
    }) ?? []
  return (
    <AttachmentTray
      present={attachmentsPresent || files.length > 0}
      className="flex flex-wrap items-start gap-2 px-4 pt-3 pb-1"
    >
      {children}
      <AnimatePresence initial={false}>
        {files.map((file) => (
          <motion.div
            key={file.key}
            layout={reduced ? false : "position"}
            initial={{ opacity: 0, y: reduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.1 : 0.18 }}
            className="relative w-56 min-w-0 max-w-full shrink-0"
            data-editor-file-card=""
            data-selected={file.selected}
          >
            <FileCardContent
              file={file}
              editor={editor}
              removeLabel={removeLabel}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </AttachmentTray>
  )
}
