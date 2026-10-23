"use client"

import { memo } from "react"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import { ContentPartsRenderer } from "./content-parts-renderer"

/** Keep prose, command groups and thinking disclosures in transcript order. */
export const ProgressSections = memo(function ProgressSections({
  parts,
  isStreaming,
}: {
  parts: AdaptedContentPart[]
  isStreaming: boolean
}) {
  return (
    <ContentPartsRenderer
      parts={parts}
      role="assistant"
      isStreaming={isStreaming}
    />
  )
})
