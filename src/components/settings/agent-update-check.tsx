"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { acpCheckAgentUpdate, type AgentUpdateRelease } from "@/lib/api"
import { compareAgentVersions } from "@/lib/agent-update-status"
import type { AcpAgentInfo, AgentType } from "@/lib/types"

const CACHE_MS = 10 * 60 * 1000

type CheckState = {
  agentType: AgentType
  loading: boolean
  release?: AgentUpdateRelease
  error?: string
}

export function AgentUpdateCheck({
  agent,
  onInstallVersion,
  busy = false,
}: {
  agent: AcpAgentInfo
  onInstallVersion: (version: string) => void
  busy?: boolean
}) {
  const t = useTranslations("AgentUpdateSettings")
  const [state, setState] = useState<CheckState>()
  // Instance-local: never reuse another remote workspace's release information.
  // Cache promises as well as results to deduplicate StrictMode/switching agents.
  const cache = useRef(
    new Map<
      AgentType,
      {
        expires: number
        promise: Promise<AgentUpdateRelease>
      }
    >()
  )
  const sequence = useRef(0)
  const agentType = agent.agent_type
  const check = useCallback(
    async (force = false) => {
      const request = ++sequence.current
      let entry = cache.current.get(agentType)
      if (force || !entry || entry.expires <= Date.now()) {
        entry = {
          expires: Date.now() + CACHE_MS,
          promise: acpCheckAgentUpdate(agentType),
        }
        cache.current.set(agentType, entry)
      }
      try {
        const release = await entry.promise
        if (request === sequence.current)
          setState({ agentType, loading: false, release })
      } catch (error) {
        if (cache.current.get(agentType) === entry)
          cache.current.delete(agentType)
        if (request === sequence.current) {
          setState({
            agentType,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    },
    [agentType]
  )

  const cancel = useCallback(() => {
    sequence.current++
  }, [])
  useEffect(() => {
    // check only commits state after awaiting the network/cached promise.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check()
    return cancel
  }, [check, cancel])

  const current = state?.agentType === agentType ? state : undefined
  const loading = !current || current.loading
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
            setState({ agentType, loading: true })
            void check(true)
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
        ) : !latest ? (
          t("unavailable")
        ) : (
          <>
            <p>
              {t("release", {
                version: latest,
                source: release.source === "npm" ? "npm" : "ACP Registry",
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
