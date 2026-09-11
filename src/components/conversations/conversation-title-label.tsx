import type { ComponentPropsWithoutRef } from "react"

import {
  formatConversationTitle,
  parseStructuredConversationTitle,
} from "@/lib/conversation-title"
import { cn } from "@/lib/utils"

/**
 * Sidebar conversation title. Structured auto-titles (`MMDD｜类型｜主题`) pin
 * the date in a 4ch tabular slot so a skinny `1` cannot shift the type column;
 * only the topic truncates. Unstructured / renamed titles stay one string.
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
    <span className={cn("flex min-w-0 items-center", className)} {...rest}>
      <span className="w-[4ch] shrink-0 tabular-nums">{structured.date}</span>
      <span className="shrink-0">{`｜${structured.kind}｜`}</span>
      <span className="min-w-0 truncate">{structured.topic}</span>
    </span>
  )
}
