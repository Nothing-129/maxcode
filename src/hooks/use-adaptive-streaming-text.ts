/// <reference lib="es2022.intl" />
"use client"

import { useEffect, useRef, useState } from "react"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Buffer live deltas only. Mounts, replacements and finished replies are immediate. */
export function useAdaptiveStreamingText(text: string, enabled: boolean) {
  const [displayed, setDisplayed] = useState(text)
  const visible = useRef(text)
  const timing = useRef({ previous: 0, credit: 0, sincePaint: 0 })

  useEffect(() => {
    let frame = 0
    const clock = timing.current
    if (!clock.previous) clock.previous = performance.now()

    const flush = () => {
      visible.current = text
      clock.previous = 0
      clock.credit = 0
      clock.sincePaint = 0
      setDisplayed(text)
    }
    if (!enabled || !text.startsWith(visible.current) || document.hidden) {
      flush()
      return
    }

    const tick = (now: number) => {
      const delta = Math.min(64, now - clock.previous)
      clock.previous = now
      clock.sincePaint += delta
      const pending = text.length - visible.current.length
      // A small delta reads like typing; a burst catches up in roughly a second,
      // rather than growing an unbounded fixed-speed queue. Paint at most 30fps.
      clock.credit += (delta / 1000) * Math.max(36, pending / 0.18)
      if (clock.sincePaint >= 32 && clock.credit >= 1) {
        let added = ""
        let count = 0
        for (const { segment } of graphemes.segment(
          text.slice(visible.current.length)
        )) {
          if (count >= Math.floor(clock.credit)) break
          added += segment
          count += 1
        }
        visible.current += added
        clock.credit -= count
        clock.sincePaint = 0
        setDisplayed(visible.current)
      }
      if (visible.current.length < text.length) {
        frame = requestAnimationFrame(tick)
      } else {
        clock.previous = 0
        clock.credit = 0
        clock.sincePaint = 0
      }
    }

    const onVisibility = () => {
      // RAF pauses in background tabs: do not replay a stale queue on return.
      cancelAnimationFrame(frame)
      flush()
    }
    document.addEventListener("visibilitychange", onVisibility)
    if (visible.current !== text) frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [text, enabled])

  return enabled && text.startsWith(displayed) ? displayed : text
}
