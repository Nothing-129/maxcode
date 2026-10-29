"use client"

export const TURN_HEADING_CLASS =
  "maxcode-turn-heading flex w-full items-center gap-1 border-b pb-1 text-[0.875rem] leading-[1.625] font-[430]"

/** Waiting and working share one node and a continuous, geometry-stable sheen. */
export function TurnStatusLabel({
  children,
  active = false,
}: {
  children: string
  active?: boolean
}) {
  return (
    <span
      role="status"
      className={`maxcode-turn-status min-w-0 truncate${active ? " maxcode-live-activity-label" : ""}`}
    >
      {children}
    </span>
  )
}
