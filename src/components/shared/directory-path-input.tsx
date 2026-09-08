"use client"

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { FolderSearch, MonitorDot } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DirectoryBrowserDialog } from "@/components/shared/directory-browser-dialog"
import { isLocalDesktop, openFileDialog } from "@/lib/platform"

interface DirectoryPathInputProps {
  value: string
  onValueChange: (path: string) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Tooltip and accessible name for the picker button. */
  browseLabel?: string
  /** Title of the in-app browser; defaults to its own generic one. */
  browserTitle?: string
  /** Directory the in-app browser opens at; defaults to the user's home. */
  initialPath?: string
}

/**
 * Directory field with the picker folded into its trailing edge.
 *
 * Which picker opens depends on where the path has to resolve: the OS dialog
 * only when the workspace is truly local, otherwise the in-app browser, which
 * walks the host that actually owns the filesystem. The icon says which one is
 * coming. Either way a pick only fills the box in — committing it stays with
 * the surrounding form, so the picker can never act on the user's behalf.
 */
export function DirectoryPathInput({
  value,
  onValueChange,
  id,
  placeholder,
  disabled,
  className,
  browseLabel,
  browserTitle,
  initialPath,
}: DirectoryPathInputProps) {
  const t = useTranslations("DirectoryBrowser")
  const [browserOpen, setBrowserOpen] = useState(false)

  const nativePicker = isLocalDesktop()
  const label = browseLabel ?? t("title")

  const handleBrowse = useCallback(async () => {
    if (!nativePicker) {
      setBrowserOpen(true)
      return
    }
    const selected = await openFileDialog({ directory: true, multiple: false })
    if (!selected) return
    const path = Array.isArray(selected) ? selected[0] : selected
    if (path) onValueChange(path)
  }, [nativePicker, onValueChange])

  return (
    <>
      {/* The app mounts no global tooltip provider — each surface brings its
          own, and Radix throws without one. */}
      <TooltipProvider delayDuration={200}>
        <InputGroup className={className}>
          <InputGroupInput
            id={id}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
          />
          <InputGroupAddon align="inline-end" className="py-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  size="icon-xs"
                  variant="ghost"
                  type="button"
                  onClick={handleBrowse}
                  disabled={disabled}
                  aria-label={label}
                >
                  {nativePicker ? (
                    <MonitorDot className="size-3.5" />
                  ) : (
                    <FolderSearch className="size-3.5" />
                  )}
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </TooltipProvider>

      <DirectoryBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={onValueChange}
        title={browserTitle}
        initialPath={initialPath}
      />
    </>
  )
}
