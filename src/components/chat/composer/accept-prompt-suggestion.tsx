"use client"

import type { RefObject } from "react"
import { CornerDownLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RichComposerHandle } from "./rich-composer"

/** A separate touch target: tapping the placeholder must only focus the editor. */
export function AcceptPromptSuggestion({
  editorRef,
  suggestion,
  label,
}: {
  editorRef: RefObject<RichComposerHandle | null>
  suggestion: string
  label: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 rounded-full text-muted-foreground"
      aria-label={label}
      title={label}
      onClick={() => {
        const editor = editorRef.current
        // Recheck the live document so a late click cannot overwrite a draft.
        if (!editor?.isEmpty() || !suggestion.trim()) return
        editor.setText(suggestion.trim())
        editor.focus()
      }}
    >
      <CornerDownLeft className="size-[18px]" strokeWidth={1.75} />
    </Button>
  )
}
