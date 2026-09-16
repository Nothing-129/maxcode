import type { AcpAgentInfo, AgentType } from "@/lib/types"

/** MaxCode's maintained catalog; historical agent types remain readable. */
export const MAINTAINED_AGENT_TYPES = [
  "codex",
  "grok",
  "deepseek",
  "pi",
  "antigravity",
  "claude_code",
] as const satisfies readonly AgentType[]

export const ALLOW_CUSTOM_AGENT_REGISTRATION = false

const maintainedAgents = new Set<string>(MAINTAINED_AGENT_TYPES)

export function isMaintainedAgent(agentType: string): boolean {
  return maintainedAgents.has(agentType)
}

export function filterMaintainedAgents<
  T extends Pick<AcpAgentInfo, "agent_type">,
>(agents: T[]): T[] {
  return agents.filter((agent) => isMaintainedAgent(agent.agent_type))
}
