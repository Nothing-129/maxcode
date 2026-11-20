"use client"

import { Switch } from "@/components/ui/switch"
import type { SessionConfigOptionInfo } from "@/lib/types"

export function isFastModeEnabled(
  option?: SessionConfigOptionInfo,
  override?: string
) {
  const current = override ?? option?.kind.current_value
  return current === true || current === "on" || current === "true"
}

export function ModelFastMode({
  option,
  checked = isFastModeEnabled(option),
  disabled,
  onSelect,
}: {
  option: SessionConfigOptionInfo
  checked?: boolean
  disabled?: boolean
  onSelect: (id: string, value: string) => void
}) {
  const values =
    option.kind.type === "select"
      ? [
          ...option.kind.options,
          ...option.kind.groups.flatMap((group) => group.options),
        ].map((item) => item.value)
      : ["true", "false"]
  const onValue = values.includes("on") ? "on" : "true"
  const offValue = values.includes("off") ? "off" : "false"
  return (
    <label className="flex shrink-0 items-center gap-3 px-3 py-2 text-sm first:border-b not-first:border-t">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Fast</span>
        {option.description && (
          <span className="block text-xs text-muted-foreground">
            {option.description}
          </span>
        )}
      </span>
      <Switch
        aria-label="Fast"
        checked={checked}
        disabled={
          disabled || !values.includes(onValue) || !values.includes(offValue)
        }
        onCheckedChange={(checked) =>
          onSelect(option.id, checked ? onValue : offValue)
        }
      />
    </label>
  )
}
