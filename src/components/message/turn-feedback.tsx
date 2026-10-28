"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"

export type TurnFeedbackKind = "send" | "reply" | "complete" | null

/** Per-list ledger survives virtualizer recycling, but never survives a reload. */
export function TurnFeedback({
  children,
  kind,
  token,
  ledger,
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
  // User messages stay static; the thread owns the send scroll.
  const feedbackKind = kind === "send" ? null : kind
  const contentRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || !feedbackKind || !contentReady || !content.animate) return
    const key = `${token}:${feedbackKind}`
    if (ledger.has(key)) return
    if (feedbackKind === "complete" && !ledger.has(`${token}:observed-reply`))
      return
    if (feedbackKind === "reply") ledger.add(`${token}:observed-reply`)
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    const animations: Animation[] = []
    let finished = false
    let started = false
    // The status is already visible before the first reply. Never fade it
    // back to zero or overlay a second label during the handoff.
    const hadWaiting = ledger.has(`${waitingToken}:waiting`)
    if (
      feedbackKind === "reply" &&
      (hadWaiting || content.querySelector(".maxcode-turn-heading"))
    ) {
      ledger.add(key)
      ledger.delete(`${waitingToken}:waiting`)
      return
    }
    const start = () => {
      if (started) return
      started = true
      ledger.add(key)
      // Completion settles the existing status heading; no new tail indicator
      // or body animation competes with the final answer.
      const target =
        feedbackKind === "complete"
          ? content.querySelector<HTMLElement>(".maxcode-turn-heading")
          : content
      if (!target) {
        finished = true
        return
      }
      const animation = target.animate(
        feedbackKind === "complete"
          ? [{ opacity: 0.65 }, { opacity: 1 }]
          : reduced
            ? [{ opacity: reduced ? 0.2 : 0 }, { opacity: 1 }]
            : [
                { opacity: 0, transform: "translateY(4px)" },
                { opacity: 1, transform: "translateY(0)" },
              ],
        {
          duration:
            feedbackKind === "complete"
              ? reduced
                ? 120
                : 240
              : reduced
                ? 120
                : 200,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        }
      )
      animations.push(animation)
      animation.onfinish = () => {
        finished = true
      }
    }
    // A new row can mount below the viewport before send auto-scroll catches
    // up. Start when visible, not while it is still in the overscan buffer.
    let observer: IntersectionObserver | undefined
    if (
      feedbackKind !== "complete" &&
      typeof IntersectionObserver !== "undefined"
    ) {
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
    }
  }, [feedbackKind, token, waitingToken, ledger, contentReady])
  return <div ref={contentRef}>{children}</div>
}
