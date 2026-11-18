"use client"

import { useId, useLayoutEffect, useRef } from "react"
import { Clock3 } from "lucide-react"
import { useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const units = ["hour", "minute"] as const

function TimeColumn({
  label,
  count,
  value,
  onChange,
}: {
  label: string
  count: number
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ digit: "", at: 0 })

  useLayoutEffect(() => {
    const column = list.current
    const selected = column?.querySelector<HTMLInputElement>("input:checked")
    if (column && selected?.parentElement) {
      const row = selected.parentElement
      column.scrollTop =
        row.offsetTop - (column.clientHeight - row.offsetHeight) / 2
    }
  }, [])

  return (
    <div
      role="radiogroup"
      aria-labelledby={id}
      className="flex min-h-0 flex-col"
    >
      <span
        id={id}
        className="pb-1 text-center text-[0.6875rem] text-muted-foreground"
      >
        {label}
      </span>
      <div
        ref={list}
        className="relative overflow-y-auto overscroll-contain [scrollbar-width:none]"
        onKeyDown={(event) => {
          if (
            !/^\d$/.test(event.key) ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return
          event.preventDefault()
          const prefix =
            event.timeStamp - typed.current.at < 1000 ? typed.current.digit : ""
          const pair = prefix + event.key
          const number = Number(pair) < count ? pair : event.key
          typed.current = {
            digit: number.length === 1 ? number : "",
            at: event.timeStamp,
          }
          const next = number.padStart(2, "0")
          onChange(next)
          list.current
            ?.querySelector<HTMLInputElement>(`input[value="${next}"]`)
            ?.focus()
        }}
      >
        {Array.from({ length: count }, (_, index) => {
          const digits = String(index).padStart(2, "0")
          return (
            <label
              key={digits}
              className="relative flex h-7 cursor-pointer items-center justify-center rounded-md text-xs tabular-nums text-muted-foreground hover:bg-foreground/5 has-checked:bg-foreground/10 has-checked:font-semibold has-checked:text-foreground has-focus-visible:outline-1 has-focus-visible:-outline-offset-1 has-focus-visible:outline-foreground/45 pointer-coarse:h-11"
            >
              <input
                type="radio"
                name={id}
                value={digits}
                checked={digits === value}
                onChange={() => onChange(digits)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              {digits}
            </label>
          )
        })}
      </div>
    </div>
  )
}

export function RangeTimePicker({
  label,
  value,
  onValueChange,
}: {
  label: string
  value: string
  onValueChange: (time: string) => void
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const names = new Intl.DisplayNames(useLocale(), { type: "dateTimeField" })
  const minute = value.slice(0, 5)
  const parts = minute.split(":")
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          type="button"
          aria-label={label}
          aria-describedby={id}
          className="col-start-2 h-7 w-auto justify-self-start gap-1 rounded-sm px-1 text-xs font-normal tabular-nums text-muted-foreground hover:text-foreground focus-visible:text-foreground pointer-coarse:min-h-11 @min-[12rem]:col-start-3"
        >
          <span id={id} dir="ltr">
            {minute}
          </span>
          <Clock3
            aria-hidden="true"
            className="size-3 opacity-0 group-hover/button:opacity-60 group-focus-visible/button:opacity-60 group-aria-expanded/button:opacity-60 pointer-coarse:opacity-60"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={panel}
        aria-label={label}
        align="end"
        collisionPadding={8}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          panel.current
            ?.querySelector<HTMLInputElement>("input:checked")
            ?.focus({ preventScroll: true })
        }}
        className="grid h-44 max-h-(--radix-popover-content-available-height) w-32 max-w-(--radix-popover-content-available-width) grid-cols-2 gap-1 rounded-xl p-1.5 shadow-lg"
      >
        {units.map((unit, index) => (
          <TimeColumn
            key={unit}
            label={names.of(unit) ?? unit}
            count={unit === "hour" ? 24 : 60}
            value={parts[index]}
            onChange={(digits) =>
              onValueChange(
                parts.map((part, i) => (i === index ? digits : part)).join(":")
              )
            }
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}
