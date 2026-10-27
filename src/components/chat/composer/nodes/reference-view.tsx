import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react"

import { ReferenceBadge } from "../badges/reference-badge"
import type { ReferenceAttrs } from "../types"

/**
 * React node view for the `reference` atom. Renders the inline badge and marks
 * the surface non-editable so the caret treats the whole reference as one unit.
 */
export function ReferenceView({ node }: ReactNodeViewProps) {
  const attrs = node.attrs as ReferenceAttrs
  return (
    <NodeViewWrapper
      as="span"
      className="codeg-reference"
      data-composer-reference={attrs.refType}
      aria-hidden={attrs.refType === "file" || undefined}
      contentEditable={false}
    >
      {attrs.refType !== "file" && <ReferenceBadge data={attrs} />}
    </NodeViewWrapper>
  )
}
