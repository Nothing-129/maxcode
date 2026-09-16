"use client"

import { useEffect, useRef, useState } from "react"
import { Power } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  SettingsError,
  SettingsSection,
} from "@/components/shared/settings-section"
import { Switch } from "@/components/ui/switch"
import { getElectronBridge, type LoginItemState } from "@/lib/electron"

export function LoginItemSettingsSection() {
  const t = useTranslations("GeneralSettings.loginItem")
  const bridge = getElectronBridge()
  const [state, setState] = useState<LoginItemState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const generation = useRef(0)

  useEffect(() => {
    if (!bridge?.getLoginItem) return
    let disposed = false
    const refresh = async () => {
      if (saving.current) return
      const request = ++generation.current
      try {
        const next = await bridge.getLoginItem!()
        if (!disposed && request === generation.current) {
          setState(next)
          setError(null)
        }
      } catch {
        if (!disposed && request === generation.current)
          setError(t("loadFailed"))
      }
    }
    void refresh()
    window.addEventListener("focus", refresh)
    return () => {
      disposed = true
      window.removeEventListener("focus", refresh)
    }
  }, [bridge, t])

  if (
    !bridge?.getLoginItem ||
    !bridge.setLoginItem ||
    state?.supported === false
  )
    return null

  const toggle = async (enabled: boolean) => {
    if (saving.current || !state) return
    saving.current = true
    ++generation.current
    setBusy(true)
    setError(null)
    try {
      setState(await bridge.setLoginItem!(enabled))
    } catch {
      setError(t("saveFailed"))
      // A system call may have changed registration before reporting failure.
      try {
        setState(await bridge.getLoginItem!())
      } catch {
        setState(null)
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <SettingsSection
      icon={Power}
      title={t("title")}
      description={t("description")}
      htmlFor="launch-at-login"
      control={
        <Switch
          id="launch-at-login"
          checked={state?.enabled ?? false}
          disabled={busy || !state}
          onCheckedChange={(enabled) => void toggle(enabled)}
        />
      }
    >
      {state?.needsApproval && (
        <p className="text-xs text-muted-foreground">{t("needsApproval")}</p>
      )}
      {error && <SettingsError>{error}</SettingsError>}
    </SettingsSection>
  )
}
