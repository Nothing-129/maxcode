"use client"

import { motion } from "motion/react"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"

/** Only the decoration travels; labels, focus targets and editors stay still. */
export function SelectionIndicator({
  id,
  className,
  durationMs = 180,
}: {
  id: string
  className?: string
  durationMs?: number
}) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)")
  return (
    <motion.span
      aria-hidden="true"
      data-motion-selection=""
      layoutId={id}
      initial={false}
      transition={{
        duration: reduced ? 0 : durationMs / 1000,
        ease: [0.4, 0, 0.2, 1],
      }}
      className={cn("pointer-events-none absolute", className)}
    />
  )
}
