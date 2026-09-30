import type { AcpAgentInfo, AgentType } from "@/lib/types"

/** MaxCode's maintained catalog; historical agent types remain readable. */
export const MAINTAINED_AGENT_TYPES = [
  "codex",
  "grok",
  "deepseek",
  "pi",
  "antigravity",
  "claude_code",
  "zcode",
] as const satisfies readonly AgentType[]

export const ALLOW_CUSTOM_AGENT_REGISTRATION = false

/** Maintained agents temporarily withheld from settings and new sessions. */
export const SETTINGS_HIDDEN_AGENT_TYPES =
  [] as const satisfies readonly AgentType[]

const maintainedAgents = new Set<string>(MAINTAINED_AGENT_TYPES)
const settingsHiddenAgents = new Set<string>(SETTINGS_HIDDEN_AGENT_TYPES)

export function isMaintainedAgent(agentType: string): boolean {
  return maintainedAgents.has(agentType)
}

export function isHiddenFromAgentSettings(agentType: string): boolean {
  return settingsHiddenAgents.has(agentType)
}

export function filterMaintainedAgents<
  T extends Pick<AcpAgentInfo, "agent_type">,
>(agents: T[]): T[] {
  return agents.filter((agent) => isMaintainedAgent(agent.agent_type))
}
