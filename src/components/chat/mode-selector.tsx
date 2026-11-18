"use client"

import { SelectorTooltip } from "./selector-tooltip"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import {
  SELECTOR_MENU_SURFACE,
  SELECTOR_RADIO_ROWS,
} from "./selector-menu-style"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import type { SessionModeInfo } from "@/lib/types"

interface ModeSelectorProps {
  showHint?: boolean
  disabled?: boolean
  modes: SessionModeInfo[]
  selectedModeId: string | null
  onSelect: (modeId: string) => void
  label: string
}

export function InlineModeSelector({
  modes,
  selectedModeId,
  onSelect,
  label,
  showHint,
  disabled,
}: ModeSelectorProps) {
  const [open, setOpen] = useState(false)
  const selected = modes.find((mode) => mode.id === selectedModeId)
  const currentLabel = selected?.name ?? selectedModeId ?? ""
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        disabled={disabled}
        shape="pill"
        data-selector-control=""
        variant="ghost"
        size="xs"
        aria-label={currentLabel ? `${label}: ${currentLabel}` : label}
        className="min-w-0 gap-0.5 px-1 text-muted-foreground"
      >
        <span className="max-w-[10rem] truncate">{currentLabel}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
  )
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      {showHint ? (
        <SelectorTooltip
          label={label}
          description={selected?.description}
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
        side="top"
        align="start"
        className={`${SELECTOR_MENU_SURFACE} ${SELECTOR_RADIO_ROWS} w-[18.5rem] min-w-0 overflow-y-auto`}
        style={{
          maxWidth: "min(18.5rem, calc(100vw - 1rem))",
          maxHeight:
            "min(60vh, var(--radix-dropdown-menu-content-available-height))",
        }}
      >
        <DropdownMenuRadioGroup
          value={selectedModeId ?? ""}
          onValueChange={onSelect}
        >
          {modes.map((mode) => (
            <DropdownMenuRadioItem key={mode.id} value={mode.id}>
              <DropdownRadioItemContent
                configId={"mode"}
                valueId={mode.id}
                label={mode.name}
                description={mode.description}
              />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
