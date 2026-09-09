"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type RefObject,
} from "react"
import { ArrowDown, ArrowUp, Search, X } from "lucide-react"
import { useTranslations } from "next-intl"
import type { ThreadRenderItem } from "./message-list-view"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"
import type { MessageScrollContextValue } from "./message-scroll-context"

function plainText(parts: AdaptedContentPart[]): string {
  return parts
    .flatMap((part): string[] => {
      if (part.type === "text") return [part.text]
      if (part.type === "reasoning") return [part.content]
      if (part.type === "goal-run") return [plainText(part.items)]
      return []
    })
    .join("\n")
}

export function findConversationMessages(
  items: ThreadRenderItem[],
  query: string
) {
  if (!query.trim()) return []
  const needle = query.toLocaleLowerCase()
  return items.flatMap((item, index) => {
    if (item.kind !== "turn") return []
    const text = plainText(item.group.parts)
    const offset = text.toLocaleLowerCase().indexOf(needle)
    return offset < 0 ? [] : [{ key: item.key, index, text, offset }]
  })
}

export function ConversationFind({
  items,
  active,
  scrollApiRef,
  containerRef,
  historyOffset,
  loadingHistory,
  onLoadHistory,
}: {
  items: ThreadRenderItem[]
  active: boolean
  scrollApiRef: RefObject<MessageScrollContextValue | null>
  containerRef?: RefObject<HTMLDivElement | null>
  historyOffset: number
  loadingHistory: boolean
  onLoadHistory: () => void
}) {
  const t = useTranslations("Folder.chat.conversationFind")
  const highlightName = `conversation-find-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const attemptedOffset = useRef<number | null>(null)
  const matches = useMemo(
    () => findConversationMessages(items, query),
    [items, query]
  )
  const selectedIndex = Math.max(
    0,
    matches.findIndex((match) => match.key === selectedKey)
  )
  const selected = matches[selectedIndex]
  const selectedRow = selected?.index
  const selectedId = selected?.key
  const close = useCallback(() => {
    setOpen(false)
    returnFocusRef.current?.focus({ preventScroll: true })
  }, [])
  const show = useCallback(() => {
    if (document.activeElement !== inputRef.current) {
      returnFocusRef.current = document.activeElement as HTMLElement | null
    }
    setOpen(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault()
        show()
      } else if (open && event.key === "Escape") {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, open, show, close])

  // Each history boundary is requested once. A failed request stays retryable,
  // rather than spinning forever against an unavailable history endpoint.
  useEffect(() => {
    if (
      !active ||
      !open ||
      !query.trim() ||
      !historyOffset ||
      loadingHistory ||
      attemptedOffset.current === historyOffset
    )
      return
    attemptedOffset.current = historyOffset
    onLoadHistory()
  }, [active, open, query, historyOffset, loadingHistory, onLoadHistory])

  useEffect(() => {
    if (!active || !open || selectedRow === undefined) return
    scrollApiRef.current?.scrollToIndex(selectedRow, { align: "start" })
  }, [active, open, selectedId, selectedRow, scrollApiRef])

  useEffect(() => {
    const container = containerRef?.current
    if (!active || !open || selectedRow === undefined || !container) return
    if (
      typeof CSS === "undefined" ||
      !CSS.highlights ||
      typeof Highlight === "undefined"
    )
      return
    const update = () => {
      const row = container.querySelector(
        `[data-thread-index="${selectedRow}"]`
      )
      const ranges: Range[] = []
      if (row) {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        let node: Node | null
        while ((node = walker.nextNode())) {
          if (node.parentElement?.closest("button,script,style")) continue
          const text = node.textContent?.toLocaleLowerCase() ?? ""
          const needle = query.toLocaleLowerCase()
          for (
            let offset = text.indexOf(needle);
            needle && offset >= 0;
            offset = text.indexOf(needle, offset + needle.length)
          ) {
            const range = document.createRange()
            range.setStart(node, offset)
            range.setEnd(
              node,
              Math.min(offset + query.length, node.textContent?.length ?? 0)
            )
            ranges.push(range)
          }
        }
      }
      CSS.highlights.set(highlightName, new Highlight(...ranges))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => {
      observer.disconnect()
      CSS.highlights.delete(highlightName)
    }
  }, [active, open, selectedRow, query, containerRef, highlightName])

  const move = (direction: number) => {
    if (!matches.length) return
    setSelectedKey(
      matches[(selectedIndex + direction + matches.length) % matches.length].key
    )
  }
  if (!active) return null
  const buttonClass =
    "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
  return (
    <div
      data-conversation-find=""
      className="absolute right-3 top-2 z-30 max-w-[calc(100%-1.5rem)]"
    >
      <style>{`::highlight(${highlightName}) { background-color: #fde68a; color: #111827; }`}</style>
      {!open ? (
        <button
          type="button"
          className={`${buttonClass} max-md:hidden bg-background/90`}
          aria-label={t("title")}
          title={t("title")}
          onClick={show}
        >
          <Search className="size-4" />
        </button>
      ) : (
        <div
          role="search"
          aria-label={t("title")}
          className="w-96 max-w-full rounded-lg border bg-background p-2 shadow-md"
        >
          <div className="flex items-center gap-1">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              aria-label={t("title")}
              placeholder={t("title")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedKey(null)
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === "Enter") {
                  event.preventDefault()
                  move(event.shiftKey ? -1 : 1)
                }
              }}
              className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
            />
            <span
              aria-live="polite"
              className="shrink-0 text-xs text-muted-foreground"
            >
              {selected ? selectedIndex + 1 : 0}/{matches.length}
            </span>
            <button
              type="button"
              className={buttonClass}
              disabled={!matches.length}
              aria-label={t("previous")}
              onClick={() => move(-1)}
            >
              <ArrowUp className="size-4" />
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={!matches.length}
              aria-label={t("next")}
              onClick={() => move(1)}
            >
              <ArrowDown className="size-4" />
            </button>
            <button
              type="button"
              className={buttonClass}
              aria-label={t("close")}
              onClick={close}
            >
              <X className="size-4" />
            </button>
          </div>
          {query.trim() && (
            <p className="mt-1 text-xs text-muted-foreground" role="status">
              {historyOffset
                ? t(loadingHistory ? "loading" : "partial")
                : t(matches.length ? "count" : "empty", {
                    count: matches.length,
                  })}
            </p>
          )}
          {query.trim() && historyOffset > 0 && !loadingHistory && (
            <button
              type="button"
              className="mt-1 text-xs underline"
              onClick={onLoadHistory}
            >
              {t("retry")}
            </button>
          )}
          {selected && (
            <p className="mt-2 break-words text-xs text-muted-foreground">
              {selected.offset > 50 ? "…" : ""}
              {selected.text.slice(
                Math.max(0, selected.offset - 50),
                selected.offset
              )}
              <mark className="rounded bg-yellow-200 text-black">
                {selected.text.slice(
                  selected.offset,
                  selected.offset + query.length
                )}
              </mark>
              {selected.text.slice(
                selected.offset + query.length,
                selected.offset + query.length + 100
              )}
              {selected.text.length > selected.offset + query.length + 100
                ? "…"
                : ""}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
