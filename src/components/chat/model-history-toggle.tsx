"use client"

import { useTranslations } from "next-intl"
import { ChevronDown } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"

export function ModelHistoryToggle({
  expanded,
  count,
  onToggle,
  menu = false,
}: {
  expanded: boolean
  count: number
  onToggle: () => void
  menu?: boolean
}) {
  const t = useTranslations("ModelHistory")
  const contents = (
    <>
      <ChevronDown
        aria-hidden
        className={`size-3.5 ${expanded ? "rotate-180" : ""}`}
      />
      <span>{t(expanded ? "collapse" : "expand", { count })}</span>
    </>
  )
  const className =
    "flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted/80 focus-visible:outline focus-visible:outline-2"
  return menu ? (
    <DropdownMenuItem
      aria-expanded={expanded}
      className={className}
      onSelect={(event) => {
        event.preventDefault()
        onToggle()
      }}
    >
      {contents}
    </DropdownMenuItem>
  ) : (
    <button
      type="button"
      aria-expanded={expanded}
      className={className}
      onClick={onToggle}
    >
      {contents}
    </button>
  )
}
