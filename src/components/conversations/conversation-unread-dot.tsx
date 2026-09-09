import { cn } from "@/lib/utils"

/** Codex-style unread marker: a thread has new content since last viewed. */
export function ConversationUnreadDot({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  return (
    <span
      data-unread-dot
      className={cn(
        "inline-flex size-2 shrink-0 rounded-full bg-[#3b82f6]",
        className
      )}
      title={label}
      aria-label={label}
    />
  )
}
