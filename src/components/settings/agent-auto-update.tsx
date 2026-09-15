"use client"

import { useEffect, useState } from "react"
import { acpAgentAutoUpdateStatus, type AgentAutoUpdateStatus } from "@/lib/api"
import type { AcpAgentInfo } from "@/lib/types"

/** Poll the selected agent's background update worker for Version Status. */
export function useAgentAutoUpdateStatus(
  agent: AcpAgentInfo | null | undefined
): AgentAutoUpdateStatus | null {
  const [status, setStatus] = useState<AgentAutoUpdateStatus | null>(null)
  useEffect(() => {
    if (!agent?.enabled) {
      setStatus(null)
      return
    }
    const agentType = agent.agent_type
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const result = await acpAgentAutoUpdateStatus(agentType)
        if (!cancelled) setStatus(result)
      } catch (error) {
        if (!cancelled) {
          setStatus({
            phase: "error",
            version: null,
            error: error instanceof Error ? error.message : String(error),
          })
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
  }, [agent?.agent_type, agent?.enabled])
  return status
}
