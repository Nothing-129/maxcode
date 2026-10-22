import type { ComponentPropsWithoutRef } from "react"

import {
  formatConversationTitle,
  parseStructuredConversationTitle,
} from "@/lib/conversation-title"
import { cn } from "@/lib/utils"

/**
 * Sidebar conversation title. Structured auto-titles (`MMDD｜类型｜主题`) show
 * only date and topic on all screen sizes, with the date in a fixed 4ch
 * tabular slot. The type is omitted; stored titles are unchanged.
 * Unstructured titles stay one string.
 */
export function ConversationTitleLabel({
  title,
  fallback,
  className,
  ...rest
}: {
  title: string | null | undefined
  fallback: string
} & Omit<ComponentPropsWithoutRef<"span">, "title">) {
  const formatted = formatConversationTitle(title)
  const text = formatted || fallback
  const structured = formatted
    ? parseStructuredConversationTitle(formatted)
    : null
  if (!structured) {
    return (
      <span className={cn("truncate", className)} {...rest}>
        {text}
      </span>
    )
  }
  return (
    <span
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...rest}
    >
      <span className="w-[4ch] shrink-0 text-xs text-muted-foreground tabular-nums">
        {structured.date}
      </span>
      <span className="min-w-0 truncate">{structured.topic}</span>
    </span>
  )
}
