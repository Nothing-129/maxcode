"use client"

import { memo, type RefObject } from "react"
import { Tooltip } from "radix-ui"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { ThreadRenderItem } from "./message-list-view"
import type { MessageScrollContextValue } from "./message-scroll-context"

export interface MessageRailEntry {
  id: string
  threadIndex: number
  question: string
  answer: string
}

/** Read plain text only; navigating never parses diffs or renders tools. */
export function buildMessageRailEntries(items: ThreadRenderItem[]) {
  const entries: MessageRailEntry[] = []
  for (const [threadIndex, item] of items.entries()) {
    if (item.kind !== "turn") continue
    const text = item.group.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim()
      .slice(0, 800)
    if (item.group.role === "user") {
      entries.push({
        id: item.group.id,
        threadIndex,
        question: text,
        answer: "",
      })
    } else if (item.group.role === "assistant" && entries.length && text) {
      const entry = entries[entries.length - 1]
      entry.answer = [entry.answer, text]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 1200)
    }
  }
  return entries
}

export const ConversationMessageRail = memo(function ConversationMessageRail({
  entries,
  visibleIndex,
  scrollApiRef,
}: {
  entries: MessageRailEntry[]
  visibleIndex: number
  scrollApiRef: RefObject<MessageScrollContextValue | null>
}) {
  const t = useTranslations("Folder.chat.messageNav")
  if (!entries.length) return null
  let active = entries[0].id
  for (const entry of entries) {
    if (entry.threadIndex > visibleIndex) break
    active = entry.id
  }
  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={100}>
      <nav
        aria-label={t("title")}
        data-message-rail=""
        className="group/rail absolute start-1 top-1/2 z-20 hidden md:flex max-h-[min(60%,24rem)] w-8 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {entries.map((entry, index) => (
          <Tooltip.Root key={entry.id}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-label={`${index + 1}. ${entry.question || t("collapsedSummary", { count: index + 1 })}`}
                aria-current={entry.id === active ? "location" : undefined}
                onClick={() =>
                  scrollApiRef.current?.scrollToIndex(entry.threadIndex, {
                    align: "start",
                    smooth: true,
                  })
                }
                className="group/tick flex h-2.5 min-h-2.5 w-8 shrink-0 items-center px-2 outline-none focus-visible:bg-accent"
              >
                <span
                  className={cn(
                    "h-px w-1.5 rounded-full bg-foreground/25 transition-[width,background-color] duration-150 group-hover/rail:w-3 group-hover/tick:!w-6 group-hover/tick:bg-foreground/85 group-focus-visible/tick:!w-6 group-focus-visible/tick:bg-foreground/85 motion-reduce:transition-none",
                    entry.id === active &&
                      "bg-foreground/60 group-hover/rail:w-4"
                  )}
                />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                sideOffset={10}
                collisionPadding={16}
                className="pointer-events-none z-50 w-80 max-w-[calc(100vw-4rem)] rounded-2xl border border-black/10 bg-popover px-3 py-2 text-sm leading-[1.6] text-popover-foreground shadow-[0_4px_16px_rgba(0,0,0,0.08)] dark:border-white/10"
              >
                <p className="line-clamp-2 font-medium">
                  {entry.question ||
                    t("collapsedSummary", { count: index + 1 })}
                </p>
                {entry.answer && (
                  <p className="mt-0.5 line-clamp-4 whitespace-pre-line text-muted-foreground">
                    {entry.answer}
                  </p>
                )}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </nav>
    </Tooltip.Provider>
  )
})
