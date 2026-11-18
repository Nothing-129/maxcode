"use client"

import { SelectorTooltip } from "./selector-tooltip"

import { ModelHistoryToggle } from "./model-history-toggle"
import {
  isHistoricalModel,
  visibleModelGroups,
} from "@/lib/selector-presentation"
import { useState, type ReactNode } from "react"
import { ChevronDown, ToggleLeft, ToggleRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  SELECTOR_MENU_SURFACE,
  SELECTOR_RADIO_ROWS,
} from "./selector-menu-style"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import {
  isModelConfigOption,
  type ModelOptionGroup,
} from "@/lib/model-config-groups"
import type { SessionConfigOptionInfo } from "@/lib/types"

interface SessionConfigSelectorProps {
  showHint?: boolean
  disabled?: boolean
  option: SessionConfigOptionInfo
  footer?: ReactNode
  triggerSuffix?: string
  onSelect: (configId: string, valueId: string) => void
  /**
   * Frontend-derived grouping for the model picker (split on the `provider/`
   * prefix). When provided, it overrides the option's own (flat) value list;
   * a group with `name === null` renders its options with no header. `null`
   * means "no grouping" — fall back to server groups, else the flat list.
   */
  derivedGroups?: ModelOptionGroup[] | null
  /** Localized chip text for the agent's `recommended_value` row. Omit it and
   *  the recommendation is simply not shown. */
  recommendedLabel?: string
}

export function InlineSessionConfigSelector({
  option,
  footer,
  triggerSuffix = "",
  onSelect,
  derivedGroups,
  recommendedLabel,
  showHint,
  disabled,
}: SessionConfigSelectorProps) {
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [open, setOpen] = useState(false)
  if (option.kind.type !== "select") return null

  // Unified group list rendered in the dropdown body. Derived (model) groups
  // win; otherwise server-provided groups; otherwise `null` → flat options.
  // `name === null` is a headerless bucket (the leading prefix-less models).
  const renderGroups: ModelOptionGroup[] | null =
    derivedGroups && derivedGroups.length > 0
      ? derivedGroups
      : option.kind.groups.length > 0
        ? option.kind.groups.map((group) => ({
            key: group.group,
            name: group.name,
            options: group.options,
          }))
        : null

  // Resolve the trigger label against the *rendered* options so the selected
  // model shows its prefix-stripped name (its provider is already implied by
  // the group it sits in) rather than repeating `provider/`.
  const renderedOptions = renderGroups
    ? renderGroups.flatMap((group) => group.options)
    : option.kind.options
  const allGroups = renderGroups ?? [
    { key: "all", name: null, options: option.kind.options },
  ]
  const historyCount = isModelConfigOption(option)
    ? renderedOptions.filter(
        (item) =>
          isHistoricalModel(item.description) &&
          item.value !== option.kind.current_value
      ).length
    : 0
  const visibleGroups = visibleModelGroups(
    allGroups,
    option.kind.current_value,
    historyExpanded || historyCount === 0
  )
  const selected = renderedOptions.find(
    (item) => item.value === option.kind.current_value
  )
  const currentLabel = selected?.name ?? option.kind.current_value
  // The agent's recommended value, if it named one AND the caller supplied a
  // chip label. Never falls back to `current_value`: "recommended" and
  // "selected" are different claims, and badging the selected row when nothing
  // was recommended would invent one.
  const recommendedValue = recommendedLabel ? option.recommended_value : null
  const badgeFor = (value: string) =>
    value === recommendedValue ? recommendedLabel : null

  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        disabled={disabled}
        shape="pill"
        data-selector-control=""
        data-neutral-model-surface={isModelConfigOption(option) || undefined}
        variant="ghost"
        size="xs"
        aria-label={
          currentLabel
            ? `${option.name}: ${currentLabel}${triggerSuffix}`
            : option.name
        }
        className="min-w-0 gap-0.5 px-1 text-muted-foreground"
      >
        <span className="max-w-[10rem] truncate">{currentLabel}</span>
        {triggerSuffix && <span className="shrink-0">{triggerSuffix}</span>}
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
  )
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      {showHint ? (
        <SelectorTooltip
          label={option.name}
          description={option.description}
          suppressed={open}
          disabled={disabled}
        >
          {trigger}
        </SelectorTooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent
        data-composer-selector-content=""
        data-neutral-model-surface={isModelConfigOption(option) || undefined}
        side="top"
        align="start"
        className={cn(
          SELECTOR_MENU_SURFACE,
          SELECTOR_RADIO_ROWS,
          "w-[18.5rem] min-w-0",
          footer ? "flex flex-col overflow-clip" : "overflow-y-auto"
        )}
        style={{
          maxWidth: "min(18.5rem, calc(100vw - 1rem))",
          maxHeight:
            "min(60vh, var(--radix-dropdown-menu-content-available-height))",
        }}
      >
        <DropdownMenuRadioGroup
          value={option.kind.current_value}
          onValueChange={(value) => onSelect(option.id, value)}
          className={
            footer
              ? "min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
              : undefined
          }
        >
          {renderGroups
            ? visibleGroups.map((group, index) => (
                <div
                  key={group.key}
                  role={group.name ? "group" : undefined}
                  aria-label={group.name ?? undefined}
                >
                  {index > 0 && <DropdownMenuSeparator />}
                  {group.name !== null && (
                    <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
                  )}
                  {group.options.map((item) => (
                    <DropdownMenuRadioItem
                      key={`${group.key}-${item.value}`}
                      value={item.value}
                      title={item.name}
                    >
                      <DropdownRadioItemContent
                        configId={option.id}
                        valueId={item.value}
                        label={item.name}
                        description={item.description}
                        recommendedLabel={badgeFor(item.value)}
                      />
                    </DropdownMenuRadioItem>
                  ))}
                </div>
              ))
            : visibleGroups
                .flatMap((group) => group.options)
                .map((item) => (
                  <DropdownMenuRadioItem
                    key={item.value}
                    value={item.value}
                    title={item.name}
                  >
                    <DropdownRadioItemContent
                      configId={option.id}
                      valueId={item.value}
                      label={item.name}
                      description={item.description}
                      recommendedLabel={badgeFor(item.value)}
                    />
                  </DropdownMenuRadioItem>
                ))}
          {historyCount > 0 && (
            <ModelHistoryToggle
              menu
              expanded={historyExpanded}
              count={historyCount}
              onToggle={() => setHistoryExpanded((value) => !value)}
            />
          )}
        </DropdownMenuRadioGroup>
        {footer}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SessionConfigToggleProps {
  option: SessionConfigOptionInfo
  /** Same signature as the selector's: values stay opaque strings all the way
   *  to the backend, which encodes `"true"` as a real JSON boolean on the wire. */
  onSelect: (configId: string, value: string) => void
  onLabel: string
  offLabel: string
}

/**
 * An on/off config option (ACP's boolean kind — Cline 3.0.50's "Auto-approve
 * tools"). Rendered as a chip that flips on click rather than a dropdown: a
 * two-item menu for a binary choice is a wasted interaction, and the state has
 * to be readable at a glance because it changes what the agent may do without
 * asking.
 */
export function InlineSessionConfigToggle({
  option,
  onSelect,
  onLabel,
  offLabel,
}: SessionConfigToggleProps) {
  if (option.kind.type !== "boolean") return null

  const checked = option.kind.current_value
  const Icon = checked ? ToggleRight : ToggleLeft

  return (
    <Button
      shape="pill"
      data-selector-control=""
      variant="ghost"
      size="xs"
      aria-pressed={checked}
      aria-label={`${option.name}: ${checked ? onLabel : offLabel}`}
      onClick={() => onSelect(option.id, checked ? "false" : "true")}
      className={cn(
        "min-w-0 gap-1 px-1",
        checked ? "text-foreground" : "text-muted-foreground"
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          checked ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="max-w-[10rem] truncate">{option.name}</span>
    </Button>
  )
}
