"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
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

export function AgentUpdateCheck({
  agent,
  onInstallVersion,
  busy = false,
  updates: sharedUpdates,
}: {
  agent: AcpAgentInfo
  onInstallVersion: (version: string) => void
  busy?: boolean
  updates?: ReturnType<typeof useAgentUpdates>
}) {
  const t = useTranslations("AgentUpdateSettings")
  const localUpdates = useAgentUpdates(sharedUpdates ? [] : [agent])
  const updates = sharedUpdates ?? localUpdates
  const agentType = agent.agent_type
  const { check } = updates
  useEffect(() => {
    if (agent.enabled) void check(agentType)
  }, [check, agentType, agent.enabled])
  const current = updates.states[agentType]
  const loading = current?.loading ?? agent.enabled
  const release = current?.release
  const latest = release?.latestVersion
  const comparison = latest
    ? compareAgentVersions(
        agent.installed_version,
        latest,
        agentType === "openclaw"
      )
    : null
  const updateAvailable = comparison !== null && comparison < 0

  return (
    <div className="space-y-2 rounded-md border p-3" data-agent-update-check="">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{t("title")}</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={loading}
          onClick={() => {
            void check(agentType, true)
          }}
        >
          <RefreshCw
            className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
          />
          {t("check")}
        </Button>
      </div>
      <div
        role="status"
        className={
          current?.error || updateAvailable
            ? "text-xs text-amber-600 dark:text-amber-400"
            : "text-xs text-muted-foreground"
        }
      >
        {loading ? (
          t("checking")
        ) : current?.error ? (
          t("failed", { error: current.error })
        ) : !current ? (
          t("check")
        ) : !latest ? (
          t("unavailable")
        ) : (
          <>
            <p>
              {t("release", {
                version: latest,
                source:
                  release.source === "npm"
                    ? "npm"
                    : release.source === "pypi"
                      ? "PyPI"
                      : "ACP Registry",
              })}
            </p>
            <p>
              {t(
                comparison === null
                  ? "unknown"
                  : updateAvailable
                    ? "available"
                    : "current"
              )}
            </p>
          </>
        )}
      </div>
      <p className="text-2xs text-muted-foreground">{t("note")}</p>
      {!loading &&
        updateAvailable &&
        latest &&
        release?.source === "npm" &&
        agent.supports_custom_version && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => onInstallVersion(latest)}
          >
            {t("install", { version: latest })}
          </Button>
        )}
    </div>
  )
}
