"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { acpAgentAutoUpdateStatus, type AgentAutoUpdateStatus } from "@/lib/api"
import type { AcpAgentInfo } from "@/lib/types"

export function AgentAutoUpdate({ agent }: { agent: AcpAgentInfo }) {
  const t = useTranslations("AgentUpdateSettings")
  const [status, setStatus] = useState<AgentAutoUpdateStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!agent.enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const result = await acpAgentAutoUpdateStatus(agent.agent_type)
        if (!cancelled) {
          setStatus(result)
          setError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(null)
          setError(String(error))
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 10_000)
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [agent.agent_type, agent.enabled])
  return (
    <div className="space-y-2 rounded-md border p-3" data-agent-auto-update="">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium">{t("autoLabel")}</span>
      </div>
      <p className="text-2xs text-muted-foreground">{t("autoDescription")}</p>
      {agent.enabled && status && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(`autoPhase.${status.phase}`)}
          {status.version ? ` · ${status.version}` : ""}
        </p>
      )}
      {agent.enabled && (error || status?.error) && (
        <p role="alert" className="text-xs text-amber-600">
          {error || status?.error}
        </p>
      )}
    </div>
  )
}
