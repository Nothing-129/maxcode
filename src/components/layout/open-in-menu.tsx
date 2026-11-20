"use client"

import { FolderClosed, SquareTerminal } from "lucide-react"

import { VSCodeIcon } from "@/components/vscode-icon"
import {
  ContextMenuItem,
  ContextMenuSubContent,
} from "@/components/ui/context-menu"
import { isLocalDesktop } from "@/lib/platform"
import { cn } from "@/lib/utils"

const itemClassName = "gap-1.5 px-3"

export function OpenInSubContent({
  className,
  explorerLabel,
  terminalLabel,
  codeLabel,
  onOpenExplorer,
  onOpenTerminal,
  onOpenCode,
  explorerDisabled,
}: {
  className?: string
  explorerLabel: string
  terminalLabel: string
  codeLabel: string
  onOpenExplorer: () => void
  onOpenTerminal: () => void
  onOpenCode: () => void
  explorerDisabled?: boolean
}) {
  // Revealing a path requires the local native bridge.
  const explorerUnavailable = !isLocalDesktop() || Boolean(explorerDisabled)
  return (
    <ContextMenuSubContent className={cn("min-w-0 w-max", className)}>
      <ContextMenuItem
        className={itemClassName}
        disabled={explorerUnavailable}
        onSelect={onOpenExplorer}
      >
        <FolderClosed />
        {explorerLabel}
      </ContextMenuItem>
      <ContextMenuItem className={itemClassName} onSelect={onOpenTerminal}>
        <SquareTerminal />
        {terminalLabel}
      </ContextMenuItem>
      <ContextMenuItem className={itemClassName} onSelect={onOpenCode}>
        <VSCodeIcon />
        {codeLabel}
      </ContextMenuItem>
    </ContextMenuSubContent>
  )
}
