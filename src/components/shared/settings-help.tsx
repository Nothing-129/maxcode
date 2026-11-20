"use client"

import {
  createContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react"
import { CircleHelp } from "lucide-react"
import { useTranslations } from "next-intl"

// Task and repository dialogs reuse SettingRow and keep their inline descriptions.
export const SettingsHelpContext = createContext(false)

export function SettingsHelp({
  label,
  children,
}: {
  label?: string
  children: ReactNode
}) {
  const t = useTranslations("SettingsShell")
  const id = useId()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (
      !("interestForElement" in HTMLButtonElement.prototype) &&
      "showPopover" in HTMLElement.prototype
    ) {
      void import("interestfor")
    }
  }, [])

  return (
    <>
      <button
        type="button"
        data-settings-help=""
        {...{ interestfor: id }}
        popoverTarget={id}
        popoverTargetAction="show"
        aria-label={label ? t("helpFor", { label }) : t("help")}
        aria-expanded={open}
        className="relative inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-md align-middle text-muted-foreground hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground"
      >
        <CircleHelp aria-hidden="true" className="size-3.5" />
      </button>
      <span
        id={id}
        popover="hint"
        role="tooltip"
        className="settings-help-popup"
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        {children}
      </span>
    </>
  )
}
