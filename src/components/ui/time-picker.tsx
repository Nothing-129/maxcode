"use client"

import type { ComponentProps } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type TimePickerProps = Omit<
  ComponentProps<"input">,
  "type" | "value" | "onChange"
> & {
  value: string
  onValueChange: (value: string) => void
}

export function TimePicker({
  className,
  step = 60,
  onValueChange,
  ...props
}: TimePickerProps) {
  return (
    <Input
      type="time"
      step={step}
      className={cn(
        "tabular-nums [color-scheme:light] dark:[color-scheme:dark]",
        className
      )}
      onChange={(event) => onValueChange(event.target.value)}
      {...props}
    />
  )
}
