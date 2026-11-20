"use client"

import { SettingsHelp } from "@/components/shared/settings-help"
import { useCallback, useEffect, useMemo, useState } from "react"
import { RotateCcw } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useIsMac } from "@/hooks/use-is-mac"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import {
  DEFAULT_SHORTCUTS,
  INPUT_SHORTCUT_IDS,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  canShareShortcut,
  formatShortcutLabel,
  setShortcutRecorderArmed,
  shortcutFromKeyboardEvent,
  shortcutsConflict,
} from "@/lib/keyboard-shortcuts"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

export function ShortcutSettings() {
  const t = useTranslations("ShortcutSettings")
  const { shortcuts, updateShortcut, resetShortcuts } = useShortcutSettings()
  const isMac = useIsMac()
  const [recordingAction, setRecordingAction] =
    useState<ShortcutActionId | null>(null)
  const actionTitle = useCallback(
    (id: ShortcutActionId) => t(`actions.${id}.title`),
    [t]
  )
  const actionDescription = useCallback(
    (id: ShortcutActionId) => t(`actions.${id}.description`),
    [t]
  )

  const isDefault = useMemo(
    () =>
      SHORTCUT_DEFINITIONS.every(
        (definition) =>
          shortcuts[definition.id] === DEFAULT_SHORTCUTS[definition.id]
      ),
    [shortcuts]
  )

  useEffect(() => {
    setShortcutRecorderArmed(Boolean(recordingAction))
    return () => setShortcutRecorderArmed(false)
  }, [recordingAction])

  useEffect(() => {
    if (!recordingAction) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (event.key === "Escape") {
        setRecordingAction(null)
        return
      }

      const allowNoModifier = INPUT_SHORTCUT_IDS.has(recordingAction)
      const shortcut = shortcutFromKeyboardEvent(event, allowNoModifier)
      if (!shortcut) return

      // Matcher semantics, not string equality: two different strings can fire
      // on the same event (`mod+=` and `mod+shift++` both match Ctrl/Cmd+Shift+=).
      const conflict = SHORTCUT_DEFINITIONS.find(
        (definition) =>
          definition.id !== recordingAction &&
          !canShareShortcut(definition.id, recordingAction) &&
          shortcutsConflict(shortcuts[definition.id], shortcut)
      )

      if (conflict) {
        toast.error(t("toasts.conflict", { title: actionTitle(conflict.id) }))
        return
      }

      if (updateShortcut(recordingAction, shortcut)) {
        toast.success(t("toasts.updated"))
      } else {
        toast.error(t("toasts.invalid"))
      }

      setRecordingAction(null)
    }

    window.addEventListener("keydown", onKeyDown, true)

    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [actionTitle, recordingAction, shortcuts, t, updateShortcut])

  return (
    <ScrollArea className="h-full">
      <div data-settings-page="" className="w-full space-y-4 p-3 md:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="settings-help-heading flex items-center gap-1">
            <h1 data-settings-page-title="">{t("sectionTitle")}</h1>
            <SettingsHelp label={t("sectionTitle")}>
              {t("recordInstruction")}
            </SettingsHelp>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              resetShortcuts()
              setRecordingAction(null)
              toast.success(t("toasts.reset"))
            }}
            disabled={isDefault}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("resetDefault")}
          </Button>
        </div>

        <section>
          <div data-settings-list="">
            {SHORTCUT_DEFINITIONS.map((definition) => {
              const isRecording = recordingAction === definition.id

              return (
                <div
                  key={definition.id}
                  data-settings-search-id={`shortcut-${definition.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <div className="text-sm font-medium">
                      {actionTitle(definition.id)}
                    </div>
                    <SettingsHelp label={actionTitle(definition.id)}>
                      {actionDescription(definition.id)}
                    </SettingsHelp>
                  </div>
                  <Button
                    variant={isRecording ? "default" : "secondary"}
                    size="sm"
                    className="font-mono min-w-36 justify-center"
                    onClick={() => {
                      setRecordingAction((previous) =>
                        previous === definition.id ? null : definition.id
                      )
                    }}
                  >
                    {isRecording
                      ? t("recording")
                      : shortcuts[definition.id]
                        ? formatShortcutLabel(shortcuts[definition.id], isMac)
                        : t("unassigned")}
                  </Button>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}
