"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Circle, Clock3, LoaderCircle, Pause, X } from "lucide-react"
import { cn } from "@/lib/utils"
import styles from "./activity-status-icon.module.css"

export type ActivityStatus =
  | "waiting"
  | "thinking"
  | "streaming"
  | "running"
  | "approval"
  | "responded"
  | "success"
  | "error"
  | "denied"

const icons = {
  waiting: Clock3,
  thinking: Circle,
  streaming: Circle,
  running: LoaderCircle,
  approval: Pause,
  responded: Check,
  success: Check,
  error: X,
  denied: X,
}

/** Decorative only: the caller owns the localized, visible status label.
 * Animate transitions, never initial history/virtual-row mounts. No layout motion.
 */
export function ActivityStatusIcon({
  status,
  className,
}: {
  status: ActivityStatus
  className?: string
}) {
  const [transition, setTransition] = useState({ status, revision: 0 })
  if (transition.status !== status) {
    setTransition({ status, revision: transition.revision + 1 })
  }
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const looping =
    status === "waiting" || status === "thinking" || status === "running"

  useEffect(() => {
    if (!looping) return
    const element = ref.current
    if (!element) return
    let intersects = typeof IntersectionObserver === "undefined"
    const update = () => setVisible(intersects && !document.hidden)
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersects = entry.isIntersecting
            update()
          })
    observer?.observe(element)
    document.addEventListener("visibilitychange", update)
    update()
    return () => {
      observer?.disconnect()
      document.removeEventListener("visibilitychange", update)
    }
  }, [looping])

  const Icon = icons[status]
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-activity-status={status}
      data-active={looping && visible}
      className={cn(
        styles.root,
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        className
      )}
    >
      <span
        key={transition.revision}
        data-transition={transition.revision > 0}
        className={styles.face}
      >
        <Icon className={styles.glyph} />
      </span>
    </span>
  )
}
