"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
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
}: ModeSelectorProps) {
  const [open, setOpen] = useState(false)
  const selected = modes.find((mode) => mode.id === selectedModeId)
  const currentLabel = selected?.name ?? selectedModeId ?? ""
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
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
      <DropdownMenuContent
        data-composer-selector-content=""
        side="top"
        align="start"
        className="max-h-[60vh] min-w-72 overflow-y-auto"
        style={{
          maxWidth: "min(20rem, calc(100vw - 1rem))",
        }}
      >
        <DropdownMenuRadioGroup
          value={selectedModeId ?? ""}
          onValueChange={onSelect}
        >
          {modes.map((mode) => (
            <DropdownMenuRadioItem key={mode.id} value={mode.id}>
              <DropdownRadioItemContent
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
