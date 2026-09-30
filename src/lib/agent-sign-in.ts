import type { AgentType } from "@/lib/types"
import { isMaintainedAgent } from "@/lib/maintained-agents"

/** Credential changes belong to the client that owns the running agent. */
export function signInAgentForTurnFailure(
  code: string | null | undefined,
  connection:
    | {
        agentType: AgentType
        isViewer: boolean
        isDelegationChild: boolean
      }
    | null
    | undefined,
  echo: boolean,
  pathname: string
): AgentType | null {
  if (
    code !== "turn_failed_auth_required" ||
    !connection ||
    !isMaintainedAgent(connection.agentType) ||
    echo ||
    connection.isViewer ||
    connection.isDelegationChild ||
    /^\/share(?:\/|\.html)?$/.test(pathname)
  ) {
    return null
  }
  return connection.agentType
}
