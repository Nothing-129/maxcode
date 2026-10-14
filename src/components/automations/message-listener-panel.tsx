"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Radio, RotateCw, Play } from "lucide-react"
import { toast } from "sonner"
import { automationListenerStatus, automationRestartListener } from "@/lib/api"
import { Button } from "@/components/ui/button"
import type { Automation, AutomationListenerInfo } from "@/lib/types"

export function MessageListenerPanel({
  automation,
  onRun,
  busy = false,
}: {
  automation: Automation
  onRun: () => void
  busy?: boolean
}) {
  const t = useTranslations("Automations")
  const [status, setStatus] = useState<AutomationListenerInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const next = await automationListenerStatus(automation.id)
        if (!cancelled) {
          setStatus(next)
          setLoadError(null)
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [automation.id, automation.enabled, automation.updated_at])
  const restart = useCallback(async () => {
    setRestarting(true)
    try {
      await automationRestartListener(automation.id)
      setStatus(await automationListenerStatus(automation.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRestarting(false)
    }
  }, [automation.id])
  const source = automation.config?.message_trigger
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Radio className="size-4" />
          {t("listenerTitle")}
        </span>
        <span className="text-xs text-muted-foreground">
          {status
            ? t(
                `listenerState_${automation.enabled ? status.state : "stopped"}`
              )
            : t("listenerLoading")}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {source && (
          <span>
            {t(`messageScope_${source.scope}`)}
            {source.target ? ` · ${source.target}` : ""}
          </span>
        )}
        <span>
          {t("listenerPending", { count: status?.pending_count ?? 0 })}
        </span>
        <span>
          {source?.batch_minutes
            ? t("messageBatchMinutes", { minutes: source.batch_minutes })
            : t("messageImmediate")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t("listenerIdleHint")}</p>
      {status?.last_received_at && (
        <p className="text-xs text-muted-foreground">
          {t("listenerLastReceived")}:{" "}
          {new Date(status.last_received_at).toLocaleString()}
        </p>
      )}
      {(loadError || status?.error) && (
        <p role="alert" className="text-xs text-destructive">
          {loadError || status?.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onRun}
          disabled={
            busy ||
            !automation.enabled ||
            !status?.pending_count ||
            automation.last_run_status === "running"
          }
        >
          <Play className="size-3.5" />
          {t("processMessages")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void restart()}
          disabled={!automation.enabled || restarting}
        >
          <RotateCw className="size-3.5" />
          {t("listenerRestart")}
        </Button>
      </div>
    </div>
  )
}
