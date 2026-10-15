"use client"

import { memo, type RefObject } from "react"
import { Tooltip } from "radix-ui"
import { useTranslations } from "next-intl"
import { Loader2, RotateCw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MessageTurn } from "@/lib/types"
import type { ThreadRenderItem } from "./message-list-view"
import type { MessageScrollContextValue } from "./message-scroll-context"

export interface MessageRailEntry {
  id: string
  threadIndex: number | null
  /** Global turn index while the prompt is above the loaded window. */
  turnIndex?: number | null
  /** Stable conversation-wide numbering, also when earlier history fails. */
  ordinal?: number
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

/**
 * Extend the tick rail with the seam-verified outline. This reads text only;
 * the rail never parses file changes or restores the old navigation card.
 * A projected earlier reply may have no text, so its question remains useful
 * on its own. Loaded replies keep their existing question/answer tooltip.
 */
export function buildHistoryMessageRailEntries(
  items: ThreadRenderItem[],
  earlierTurns: readonly MessageTurn[] | null,
  earlierUserCount: number
): MessageRailEntry[] {
  const loaded = buildMessageRailEntries(items)
  if (earlierTurns == null) {
    return loaded.map((entry, index) => ({
      ...entry,
      ordinal: earlierUserCount + index + 1,
    }))
  }

  const entries: MessageRailEntry[] = []
  const byId = new Map<string, MessageRailEntry>()
  for (const [turnIndex, turn] of earlierTurns.entries()) {
    const text = turn.blocks
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim()
      .slice(0, 800)
    if (turn.role === "user") {
      if (byId.has(turn.id)) continue
      const entry: MessageRailEntry = {
        id: turn.id,
        threadIndex: null,
        turnIndex,
        ordinal: entries.length + 1,
        question: text,
        answer: "",
      }
      entries.push(entry)
      byId.set(turn.id, entry)
    } else if (turn.role === "assistant" && entries.length && text) {
      const entry = entries[entries.length - 1]
      entry.answer = [entry.answer, text]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 1200)
    }
  }

  // A capped window can start halfway through a reply. Its loaded text still
  // belongs to the prompt immediately above the seam.
  const seamEntry = entries[entries.length - 1]
  if (seamEntry) {
    for (const item of items) {
      if (item.kind !== "turn") continue
      if (item.group.role === "user") break
      if (item.group.role !== "assistant") continue
      const text = item.group.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim()
        .slice(0, 800)
      seamEntry.answer = [seamEntry.answer, text]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 1200)
    }
  }

  for (const entry of loaded) {
    const earlier = byId.get(entry.id)
    if (earlier) {
      // A live overlay can render a persisted prompt above the window. List
      // it once, in historical order, while jumping to its rendered copy.
      earlier.threadIndex = entry.threadIndex
      earlier.turnIndex = null
      earlier.question = entry.question || earlier.question
      earlier.answer = entry.answer || earlier.answer
      continue
    }
    entries.push({ ...entry, ordinal: entries.length + 1 })
  }
  return entries
}

export const ConversationMessageRail = memo(function ConversationMessageRail({
  entries,
  visibleIndex,
  scrollApiRef,
  onSelect,
  revealingTurnId = null,
  earlier = null,
  onRetryEarlier,
}: {
  entries: MessageRailEntry[]
  visibleIndex: number
  scrollApiRef: RefObject<MessageScrollContextValue | null>
  onSelect?: (entry: MessageRailEntry) => void
  revealingTurnId?: string | null
  earlier?: "loading" | "error" | null
  onRetryEarlier?: () => void
}) {
  const t = useTranslations("Folder.chat.messageNav")
  if (!entries.length && earlier == null) return null
  let active = entries[0]?.id
  let nearestIndex = -1
  // Earlier entries have no virtual row yet; overlay duplicates can make
  // history order differ from row order, so select the nearest loaded row.
  for (const entry of entries) {
    if (entry.threadIndex == null) {
      if (nearestIndex < 0) active = entry.id
    } else if (
      entry.threadIndex <= visibleIndex &&
      entry.threadIndex > nearestIndex
    ) {
      nearestIndex = entry.threadIndex
      active = entry.id
    }
  }
  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={100}>
      <nav
        aria-label={t("title")}
        data-message-rail=""
        className="group/rail absolute start-1 top-1/2 z-20 hidden md:flex max-h-[min(60%,24rem)] w-8 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {earlier != null && (
          <button
            type="button"
            disabled={earlier === "loading"}
            aria-label={t(
              earlier === "loading" ? "loadingEarlier" : "loadEarlier"
            )}
            title={t(earlier === "loading" ? "loadingEarlier" : "loadEarlier")}
            onClick={onRetryEarlier}
            className="flex h-6 min-h-6 w-8 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:bg-accent"
          >
            {earlier === "loading" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RotateCw className="size-3" />
            )}
          </button>
        )}
        {entries.map((entry, index) => (
          <Tooltip.Root key={entry.id}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                aria-label={`${entry.ordinal ?? index + 1}. ${entry.question || t("collapsedSummary", { count: entry.ordinal ?? index + 1 })}`}
                aria-current={entry.id === active ? "location" : undefined}
                aria-busy={entry.id === revealingTurnId || undefined}
                onClick={() => {
                  if (onSelect) return onSelect(entry)
                  if (entry.threadIndex == null) return
                  scrollApiRef.current?.scrollToIndex(entry.threadIndex, {
                    align: "start",
                    smooth: true,
                  })
                }}
                className="group/tick flex h-2.5 min-h-2.5 w-8 shrink-0 items-center px-2 outline-none focus-visible:bg-accent"
              >
                {entry.id === revealingTurnId ? (
                  <Loader2 className="size-2.5 animate-spin" />
                ) : (
                  <span
                    className={cn(
                      "h-px w-1.5 rounded-full bg-foreground/25 transition-[width,background-color] duration-150 group-hover/rail:w-3 group-hover/tick:!w-6 group-hover/tick:bg-foreground/85 group-focus-visible/tick:!w-6 group-focus-visible/tick:bg-foreground/85 motion-reduce:transition-none",
                      entry.id === active &&
                        "bg-foreground/60 group-hover/rail:w-4"
                    )}
                  />
                )}
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
                    t("collapsedSummary", {
                      count: entry.ordinal ?? index + 1,
                    })}
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
