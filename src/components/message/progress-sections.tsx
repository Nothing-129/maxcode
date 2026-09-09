"use client"

import { memo, useMemo, useState } from "react"
import { ChevronRightIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/instant-collapsible"
import { annotateToolRecovery } from "@/lib/tool-call-recovery"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { ContentPartsRenderer } from "./content-parts-renderer"

interface ProgressSection {
  start: number
  activity: boolean
  parts: AdaptedContentPart[]
}

/** Prose and artifacts are boundaries, never content of an activity disclosure. */
export function groupProgressSections(
  parts: AdaptedContentPart[]
): ProgressSection[] {
  const sections: ProgressSection[] = []
  parts.forEach((part, start) => {
    const activity = [
      "reasoning",
      "tool-call",
      "tool-result",
      "tool-group",
    ].includes(part.type)
    const previous = sections[sections.length - 1]
    if (activity && previous?.activity) previous.parts.push(part)
    else sections.push({ start, activity, parts: [part] })
  })
  return sections
}

function ActivitySection({
  parts,
  isStreaming,
}: {
  parts: AdaptedContentPart[]
  isStreaming: boolean
}) {
  const t = useTranslations("Folder.chat.messageList")
  const [open, setOpen] = useState(false)
  const count = parts.reduce(
    (total, part) =>
      total + (part.type === "tool-group" ? part.items.length : 1),
    0
  )
  const label = t("activitySteps", { count })
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-activity-section="">
      <CollapsibleTrigger className="group flex max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
        />
        {isStreaming ? (
          <Shimmer as="span">{label}</Shimmer>
        ) : (
          <span>{label}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 max-h-96 overflow-y-auto overscroll-contain border-l border-border/70 pl-3">
          <ContentPartsRenderer
            parts={parts}
            role="assistant"
            isStreaming={isStreaming}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export const ProgressSections = memo(function ProgressSections({
  parts,
  isStreaming,
}: {
  parts: AdaptedContentPart[]
  isStreaming: boolean
}) {
  const sections = useMemo(
    () => groupProgressSections(annotateToolRecovery(parts)),
    [parts]
  )
  return (
    <div className="space-y-4">
      {sections.map((section, index) =>
        section.activity && section.parts.length > 1 ? (
          <ActivitySection
            key={section.start}
            parts={section.parts}
            isStreaming={isStreaming && index === sections.length - 1}
          />
        ) : (
          <ContentPartsRenderer
            key={section.start}
            parts={section.parts}
            role="assistant"
            isStreaming={isStreaming}
          />
        )
      )}
    </div>
  )
})
