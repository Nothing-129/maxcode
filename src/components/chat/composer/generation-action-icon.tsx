"use client"

import { useLayoutEffect, useRef } from "react"
import { ArrowUp, Square } from "lucide-react"

/** Keep both glyphs mounted so a state change crossfades without moving focus. */
export function GenerationActionIcon({
  running,
  ready = false,
}: {
  running: boolean
  ready?: boolean
}) {
  const ref = useRef<SVGSVGElement>(null)
  const haloRef = useRef<HTMLSpanElement>(null)
  const previous = useRef({ ready, running })
  useLayoutEffect(() => {
    const before = previous.current
    previous.current = { ready, running }
    if (
      !ready ||
      before.ready ||
      running ||
      before.running ||
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }
    const animation = ref.current?.animate?.(
      [
        { transform: "translateY(3px) scale(0.75)" },
        { transform: "translateY(-2px) scale(1.16)", offset: 0.5 },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: 380, easing: "ease-in-out" }
    )
    const halo = haloRef.current?.animate?.(
      [
        { boxShadow: "0 0 0 0px rgb(33 106 228 / 0%)" },
        { boxShadow: "0 0 0 5px rgb(33 106 228 / 24%)", offset: 0.4 },
        { boxShadow: "0 0 0 9px rgb(33 106 228 / 0%)" },
      ],
      { duration: 480, easing: "ease-out" }
    )
    return () => {
      animation?.cancel()
      halo?.cancel()
    }
  }, [ready, running])
  return (
    <span
      aria-hidden="true"
      className="maxcode-generation-icon"
      data-running={running}
    >
      <span ref={haloRef} className="maxcode-send-ready-halo" />
      <Square
        data-generation-glyph="stop"
        className="size-3.5 fill-current"
        strokeWidth={0}
      />
      <ArrowUp
        ref={ref}
        data-generation-glyph="send"
        className="size-4"
        strokeWidth={2.5}
      />
    </span>
  )
}
