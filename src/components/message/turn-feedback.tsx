"use client"

import { WaitingDots } from "./waiting-dots"
import { CheckIcon } from "lucide-react"
import { useLayoutEffect, useRef, type ReactNode } from "react"

export type TurnFeedbackKind = "send" | "reply" | "complete" | null

/** Per-list ledger survives virtualizer recycling, but never survives a reload. */
export function TurnFeedback({
  children,
  kind,
  token,
  ledger,
  waitingLabel,
  waitingToken = token,
  contentReady = true,
}: {
  children: ReactNode
  kind: TurnFeedbackKind
  token: string
  ledger: Set<string>
  waitingLabel: string
  waitingToken?: string
  contentReady?: boolean
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const waitingRef = useRef<HTMLSpanElement>(null)
  const completedRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || !kind || !contentReady || !content.animate) return
    const key = `${token}:${kind}`
    if (ledger.has(key)) return
    if (kind === "complete" && !ledger.has(`${token}:observed-reply`)) return
    if (kind === "reply") ledger.add(`${token}:observed-reply`)
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    const waiting = waitingRef.current
    const completed = completedRef.current
    const animations: Animation[] = []
    let finished = false
    let started = false
    const hadWaiting = ledger.has(`${waitingToken}:waiting`)
    const start = () => {
      if (started) return
      started = true
      ledger.add(key)
      const target = kind === "complete" ? completed : content
      if (!target) return
      if (kind === "complete") target.hidden = false
      const animation = target.animate(
        kind === "complete"
          ? [
              { opacity: 0 },
              { opacity: 1, offset: 0.2 },
              { opacity: 1, offset: 0.8 },
              { opacity: 0 },
            ]
          : reduced
            ? [{ opacity: 0.2 }, { opacity: 1 }]
            : [
                { opacity: 0, transform: "translateY(12px)" },
                { opacity: 1, transform: "translateY(0)" },
              ],
        {
          duration: kind === "complete" ? 1100 : reduced ? 160 : 360,
          easing:
            kind === "complete" ? "linear" : "cubic-bezier(0.22, 1, 0.36, 1)",
        }
      )
      animations.push(animation)
      animation.onfinish = () => {
        finished = true
        if (kind === "complete") target.hidden = true
      }
      if (kind === "complete") {
        const heading = content.querySelector<HTMLElement>(
          ".maxcode-turn-heading"
        )
        if (heading)
          animations.push(
            heading.animate([{ opacity: 0.25 }, { opacity: 1 }], {
              duration: reduced ? 160 : 360,
            })
          )
      }
      if (kind === "reply" && waiting && hadWaiting) {
        waiting.hidden = false
        const exit = waiting.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: reduced ? 160 : 240,
          easing: "ease-out",
        })
        animations.push(exit)
        exit.onfinish = () => {
          waiting.hidden = true
          ledger.delete(`${waitingToken}:waiting`)
        }
      }
    }
    // A new row can mount below the viewport before send auto-scroll catches
    // up. Start when visible, not while it is still in the overscan buffer.
    let observer: IntersectionObserver | undefined
    if (kind !== "complete" && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          start()
          observer?.disconnect()
        }
      })
      observer.observe(content)
    } else start()
    return () => {
      observer?.disconnect()
      // Cancellation is not completion: StrictMode and recycled rows may
      // mount again before a single visible frame has been painted.
      if (started && !finished) ledger.delete(key)
      animations.forEach((animation) => animation.cancel())
      if (waiting) waiting.hidden = true
      if (completed) completed.hidden = true
    }
  }, [kind, token, waitingToken, ledger, contentReady])
  return (
    <div className="relative">
      <span
        ref={waitingRef}
        hidden
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 text-xs text-muted-foreground"
      >
        <span className="sr-only">{waitingLabel}</span>
        <WaitingDots />
      </span>
      <div ref={contentRef}>{children}</div>
      <span
        ref={completedRef}
        data-completion-feedback=""
        hidden
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 rounded-full bg-background p-1 text-muted-foreground"
      >
        <CheckIcon className="size-4" />
      </span>
    </div>
  )
}
