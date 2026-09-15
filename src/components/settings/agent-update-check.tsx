"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { RefreshCw } from "lucide-react"
import { acpCheckAgentUpdate, type AgentUpdateRelease } from "@/lib/api"
import { compareAgentVersions } from "@/lib/agent-update-status"
import type { AcpAgentInfo, AgentType } from "@/lib/types"

const CACHE_MS = 6 * 60 * 60 * 1000

type CheckState = {
  agentType: AgentType
  loading: boolean
  release?: AgentUpdateRelease
  error?: string
}

/** Page-local cache: list badges and details observe the same release checks. */
export function useAgentUpdates(agents: AcpAgentInfo[] = []) {
  const [states, setStates] = useState<Partial<Record<AgentType, CheckState>>>(
    {}
  )
  const cache = useRef(
    new Map<
      AgentType,
      {
        expires: number
        promise: Promise<void>
      }
    >()
  )
  const check = useCallback((agentType: AgentType, force = false) => {
    const cached = cache.current.get(agentType)
    if (!force && cached && cached.expires > Date.now()) return cached.promise
    const entry = { expires: Date.now() + CACHE_MS, promise: Promise.resolve() }
    cache.current.set(agentType, entry)
    // Defer notifications so automatic checks do not synchronously set effect state.
    entry.promise = Promise.resolve().then(async () => {
      if (cache.current.get(agentType) !== entry) return
      setStates((prev) => ({
        ...prev,
        [agentType]: { agentType, loading: true },
      }))
      try {
        const release = await acpCheckAgentUpdate(agentType)
        if (cache.current.get(agentType) === entry)
          setStates((prev) => ({
            ...prev,
            [agentType]: { agentType, loading: false, release },
          }))
      } catch (error) {
        if (cache.current.get(agentType) !== entry) return
        cache.current.delete(agentType)
        setStates((prev) => ({
          ...prev,
          [agentType]: {
            agentType,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }))
      }
    })
    return entry.promise
  }, [])
  const enabledTypes = agents
    .filter((agent) => agent.enabled)
    .map((agent) => agent.agent_type)
    .sort()
    .join(",")
  useEffect(() => {
    if (!enabledTypes) return
    const checkEnabled = () => {
      for (const type of enabledTypes.split(",").filter(Boolean))
        void check(type as AgentType)
    }
    checkEnabled()
    const timer = setInterval(checkEnabled, CACHE_MS)
    return () => clearInterval(timer)
  }, [enabledTypes, check])
  return { states, check }
}

export function AgentUpdateBadge({
  agent,
  updates,
}: {
  agent: AcpAgentInfo
  updates: ReturnType<typeof useAgentUpdates>
}) {
  const t = useTranslations("AgentUpdateSettings")
  const state = updates.states[agent.agent_type]
  const latest = state?.release?.latestVersion
  if (
    !agent.enabled ||
    state?.loading ||
    !latest ||
    compareAgentVersions(
      agent.installed_version,
      latest,
      agent.agent_type === "openclaw"
    ) !== -1
  )
    return null
  return (
    <span
      title={`${t("available")} ${latest}`}
      aria-label={`${t("available")} ${latest}`}
      className="text-amber-600 dark:text-amber-400 shrink-0"
      data-agent-update-available={agent.agent_type}
    >
      <RefreshCw className="h-3.5 w-3.5" />
    </span>
  )
}
