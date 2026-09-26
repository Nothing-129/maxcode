"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"

import { Eraser, MoveUpRight, Square, Undo2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  drawMarkup,
  markFromDrag,
  MIN_MARK_SCREEN_PX,
  renderMarkedScreenshot,
  withMarkup,
  type MarkupMark,
  type MarkupPoint,
  type MarkupTool,
} from "@/lib/image-markup"
import { cn } from "@/lib/utils"

/** What the person decided to send. */
export interface MarkedScreenshot {
  /** The picture with the marks drawn in — or null when nothing was drawn,
   *  and the capture goes over exactly as the backend encoded it rather than
   *  through a second, weaker encoder for no reason. */
  image: Blob | null
  /** The screenshot's block, with the marks described after it. */
  text: string
  marks: MarkupMark[]
}

const TOOL_BUTTON = cn(
  "inline-flex h-full items-center gap-1.5 rounded-xl border border-transparent px-2.5 text-sm font-medium text-foreground/60 transition-all outline-none",
  "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
  "aria-pressed:bg-background aria-pressed:text-foreground dark:aria-pressed:border-input dark:aria-pressed:bg-input/30"
)

/**
 * Boxes and arrows over a screenshot, before it goes to a conversation.
 *
 * Opened by "Mark up a screenshot…" with the capture already taken: the page
 * behind the dialog keeps living — it can scroll, navigate, redraw — and the
 * picture is the moment the person asked for, not whatever the page shows by
 * the time they finish drawing.
 *
 * Mounted only while it is open, so every opening starts from a clean sheet;
 * closing it by any route (Cancel, Escape, the close button) sends nothing —
 * including a picture that was still being made when it was closed.
 */
export function ScreenshotMarkupDialog({
  capture,
  initialMarks = [],
  text,
  onCancel,
  onSend,
  onFailed,
}: {
  capture: { mime: string; data: string; width?: number; height?: number }
  initialMarks?: MarkupMark[]
  /** The block the backend wrote for this screenshot. */
  text: string
  onCancel: () => void
  onSend: (result: MarkedScreenshot) => void | Promise<void>
  /** The picture could not be read: there is nothing to draw on, and the
   *  dialog is done. The caller says so. */
  onFailed: (error: unknown) => void
}) {
  const t = useTranslations("ImageMarkup")
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<MarkupTool>("box")
  // Every state the marks have been in, newest last. Clearing is one more
  // state rather than a wipe, so "Clear" is as undoable as a stroke is.
  const [history, setHistory] = useState<MarkupMark[][]>([initialMarks])
  const marks = history[history.length - 1]
  const [draft, setDraft] = useState<MarkupMark | null>(null)
  const dragRef = useRef<{ pointerId: number; start: MarkupPoint } | null>(null)
  const [sending, setSending] = useState(false)
  const [committing, setCommitting] = useState(false)
  // Whether this sheet may still deliver. Making the picture is asynchronous,
  // and closing stays possible while it runs — Escape, the close button,
  // Cancel — so a picture finished after the person let the sheet go (or
  // after it was taken off screen) must go nowhere.
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])
  const width = capture.width ?? image?.naturalWidth ?? 1
  const height = capture.height ?? image?.naturalHeight ?? 1

  const onFailedRef = useRef(onFailed)
  useEffect(() => {
    onFailedRef.current = onFailed
  }, [onFailed])

  useEffect(() => {
    let live = true
    const element = new Image()
    element.onload = () => {
      if (live) setImage(element)
    }
    element.onerror = () => {
      if (live)
        onFailedRef.current(new Error("the screenshot could not be read"))
    }
    element.src = `data:${capture.mime};base64,${capture.data}`
    return () => {
      live = false
      element.onload = null
      element.onerror = null
    }
  }, [capture.mime, capture.data])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    drawMarkup(ctx, image, draft ? [...marks, draft] : marks, {
      width,
      height,
    })
  }, [image, marks, draft, width, height])

  /** A pointer position in the picture's own pixels. The canvas is shown
   *  scaled to fit, so the screen position is read against where it actually
   *  sits — and held to its edges, so a drag that starts in the margin or runs
   *  off the picture still starts and ends on it. */
  const pointOf = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const x = ((event.clientX - rect.left) / rect.width) * width
      const y = ((event.clientY - rect.top) / rect.height) * height
      return {
        point: {
          x: Math.max(0, Math.min(width, x)),
          y: Math.max(0, Math.min(height, y)),
        },
        // What a few pixels on screen are in the picture's pixels.
        min: (MIN_MARK_SCREEN_PX * width) / rect.width,
      }
    },
    [width, height]
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !image || sending) return
    const at = pointOf(event)
    if (!at) return
    event.preventDefault()
    // Keep the drag when the pointer leaves the picture: without the capture,
    // a box dragged past the edge would stop following at the border.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, start: at.point }
    setDraft(null)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const at = pointOf(event)
    if (!at) return
    // The same threshold the release applies, so the mark on screen while
    // dragging is exactly the one that stays — nothing appears and then
    // vanishes on letting go.
    setDraft(markFromDrag(tool, drag.start, at.point, at.min))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraft(null)
    const at = pointOf(event)
    if (!at) return
    const mark = markFromDrag(tool, drag.start, at.point, at.min)
    if (!mark) return
    setHistory((past) => [...past, [...past[past.length - 1], mark]])
  }

  const dropDrag = () => {
    dragRef.current = null
    setDraft(null)
  }

  // Only the pointer that is drawing can call its drag off: another one
  // being cancelled or let go of says nothing about it.
  const dropDragOf = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dropDrag()
  }

  const undo = useCallback(() => {
    setHistory((past) => (past.length > 1 ? past.slice(0, -1) : past))
  }, [])

  const clear = useCallback(() => {
    setHistory((past) =>
      past[past.length - 1].length > 0 ? [...past, []] : past
    )
  }, [])

  const cancel = useCallback(() => {
    liveRef.current = false
    onCancel()
  }, [onCancel])

  const send = useCallback(() => {
    // Not mid-drag (⌘Enter with the pointer still down): the mark being drawn
    // is on screen but not on the sheet yet, and the picture would go without
    // it.
    if (sending || dragRef.current) return
    if (marks.length === 0 && initialMarks.length === 0) {
      onSend({ image: null, text, marks: [] })
      return
    }
    if (!image) return
    setSending(true)
    void (async () => {
      try {
        const blob = await renderMarkedScreenshot(image, marks, {
          width,
          height,
        })
        if (!liveRef.current) return
        setCommitting(true)
        await onSend({
          image: blob,
          marks,
          text: withMarkup(text, marks, {
            width,
            height,
            region: { x: 0, y: 0, width, height },
          }),
        })
      } catch (error) {
        if (!liveRef.current) return
        toast.error(t("failed"), { description: String(error) })
      } finally {
        if (liveRef.current) {
          setSending(false)
          setCommitting(false)
        }
      }
    })()
  }, [
    sending,
    marks,
    image,
    width,
    height,
    text,
    initialMarks.length,
    onSend,
    t,
  ])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!event.metaKey && !event.ctrlKey) return
    if (event.key === "Enter") {
      event.preventDefault()
      send()
    } else if (event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault()
      // The picture being made is of the marks as they were when "Add to
      // chat" was pressed; taking one away on screen now would send a
      // picture that disagrees with the sheet.
      if (!sending) undo()
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !committing) cancel()
      }}
    >
      <DialogContent
        className="max-w-[min(1280px,calc(100vw-2rem))] gap-4 p-5"
        onKeyDown={onKeyDown}
        // Into the dialog itself rather than onto its first control: a focus
        // ring on "Box" beside a pressed "Arrow" reads as two tools chosen at
        // once. Escape, ⌘Z and ⌘Enter reach it here, and Tab still walks in.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (event.target instanceof HTMLElement) event.target.focus()
        }}
        // Escape mid-drag drops the mark being drawn, not everything drawn.
        onEscapeKeyDown={(event) => {
          if (!dragRef.current) return
          event.preventDefault()
          dropDrag()
        }}
        // A stray click beside the picture must not throw the marks away.
        onPointerDownOutside={(event) => {
          if (marks.length > 0) event.preventDefault()
        }}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("markupTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t("markupTools")}
            className="inline-flex h-9 items-center rounded-4xl bg-muted p-[3px]"
          >
            <button
              type="button"
              className={TOOL_BUTTON}
              aria-pressed={tool === "box"}
              onClick={() => setTool("box")}
            >
              <Square />
              {t("markupBox")}
            </button>
            <button
              type="button"
              className={TOOL_BUTTON}
              aria-pressed={tool === "arrow"}
              onClick={() => setTool("arrow")}
            >
              <MoveUpRight />
              {t("markupArrow")}
            </button>
          </div>
          <div className="ms-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={history.length <= 1 || sending}
            >
              <Undo2 />
              {t("markupUndo")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={marks.length === 0 || sending}
            >
              <Eraser />
              {t("markupClear")}
            </Button>
          </div>
        </div>
        {/* The whole well is the drawing surface, not just the picture in it:
            a box around something at the picture's edge is easiest started
            just outside it, and the picture's own rounded corners would
            otherwise turn a press right on the corner into nothing. */}
        <div
          className="flex min-h-0 min-w-0 cursor-crosshair touch-none items-center justify-center rounded-2xl bg-muted/40 p-2 select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={dropDragOf}
          onLostPointerCapture={dropDragOf}
        >
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            role="img"
            aria-label={t("markupTitle")}
            className="block h-auto max-h-[calc(100dvh-15rem)] w-auto max-w-full rounded-lg shadow-sm ring-1 ring-border"
          />
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {marks.length > 0
              ? t("markupCount", { count: marks.length })
              : t("markupHint")}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={cancel} disabled={committing}>
              {t("markupCancel")}
            </Button>
            <Button onClick={send} disabled={sending || !image}>
              {t("markupSend")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
