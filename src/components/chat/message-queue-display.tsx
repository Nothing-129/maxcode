"use client"

import { useCallback, useRef, useState, type PointerEvent } from "react"
import { Reorder, useDragControls } from "motion/react"
import { CornerDownRight, ListPlus, Pencil, Trash2, Zap } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { QueuedMessage } from "@/hooks/use-message-queue"

interface MessageQueueDisplayProps {
  queue: QueuedMessage[]
  onReorder: (items: QueuedMessage[]) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onAdjustDirection?: (id: string) => void
  onSteerItem?: (id: string) => Promise<void>
  steering?: boolean
  editingItemId: string | null
}

interface QueueItemProps {
  item: QueuedMessage
  onAdjustDirection?: (id: string) => void
  onSteerItem?: (id: string) => Promise<void>
  steering?: boolean
  isEditing: boolean
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

function QueueItem({
  item,
  onAdjustDirection,
  onSteerItem,
  steering = false,
  isEditing,
  onEdit,
  onDelete,
}: QueueItemProps) {
  const t = useTranslations("Folder.chat.messageQueue")
  const dragControls = useDragControls()

  const startDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!steering) dragControls.start(event)
    },
    [dragControls, steering]
  )

  return (
    <Reorder.Item
      as="div"
      value={item}
      dragListener={false}
      dragControls={dragControls}
      className={cn(
        "group flex min-h-10 items-center gap-2 px-3 py-1.5 text-sm",
        "border-b border-border/40 last:border-b-0",
        isEditing && "border-primary/50 bg-primary/5"
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/60 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        aria-label={t("reorderItem")}
        onPointerDown={startDrag}
      >
        <ListPlus className="size-3.5" />
      </button>
      <span
        className="min-w-0 flex-1 truncate font-medium text-foreground"
        title={item.draft.displayText}
      >
        {item.draft.displayText}
      </span>
      {onSteerItem && !isEditing ? (
        <button
          type="button"
          onClick={() => void onSteerItem(item.id)}
          disabled={steering}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("steerItemNowHint")}
        >
          <Zap className="size-3.5" />
          {t("steerItemNow")}
        </button>
      ) : onAdjustDirection ? (
        <button
          type="button"
          onClick={() => onAdjustDirection(item.id)}
          disabled={steering}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("adjustDirectionHint")}
        >
          <CornerDownRight className="size-3.5" />
          {t("adjustDirection")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onEdit(item.id)}
        disabled={steering}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={t("editItem")}
        aria-label={t("editItem")}
        aria-pressed={isEditing}
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onDelete(item.id)}
        disabled={steering}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={t("deleteItem")}
        aria-label={t("deleteItem")}
      >
        <Trash2 className="size-3.5" />
      </button>
    </Reorder.Item>
  )
}

export function MessageQueueDisplay({
  queue,
  onReorder,
  onEdit,
  onDelete,
  editingItemId,
  onAdjustDirection,
  onSteerItem,
  steering = false,
}: MessageQueueDisplayProps) {
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const handleSteer = useCallback(
    async (id: string) => {
      if (!onSteerItem || pendingRef.current || steering) return
      pendingRef.current = true
      setPending(true)
      try {
        await onSteerItem(id)
      } finally {
        pendingRef.current = false
        setPending(false)
      }
    },
    [onSteerItem, steering]
  )

  if (queue.length === 0) return null

  return (
    <div className="mx-3 -mb-3 max-h-40 overflow-y-auto rounded-t-2xl border border-b-0 border-border/60 bg-background/95 pb-3">
      <Reorder.Group
        as="div"
        axis="y"
        values={queue}
        onReorder={onReorder}
        className="flex flex-col"
      >
        {queue.map((item) => (
          <QueueItem
            key={item.id}
            item={item}
            isEditing={editingItemId === item.id}
            onEdit={onEdit}
            onDelete={onDelete}
            onAdjustDirection={editingItemId ? undefined : onAdjustDirection}
            onSteerItem={
              editingItemId || !onSteerItem ? undefined : handleSteer
            }
            steering={steering || pending}
          />
        ))}
      </Reorder.Group>
    </div>
  )
}
