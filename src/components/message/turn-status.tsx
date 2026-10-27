"use client"

export const TURN_HEADING_CLASS =
  "maxcode-turn-heading flex w-full items-center gap-1 border-b pb-1 text-[0.875rem] leading-[1.625] font-[430]"

/** One quiet, neutral sweep for both pre-response and live work labels. */
export function TurnStatusLabel({ children }: { children: string }) {
  return (
    <span className="maxcode-turn-status min-w-0 truncate">{children}</span>
  )
}
