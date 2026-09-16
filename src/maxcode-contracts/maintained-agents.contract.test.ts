import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ALLOW_CUSTOM_AGENT_REGISTRATION,
  MAINTAINED_AGENT_TYPES,
} from "@/lib/maintained-agents"
import type { AcpAgentInfo } from "@/lib/types"
import { AGENT_DISPLAY_ORDER } from "@/lib/types"
import {
  loadEnabledAcpAgentsCache,
  saveEnabledAcpAgentsCache,
} from "@/lib/enabled-acp-agents-storage"

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: mocks.call }),
}))
import { acpListAgents, acpListEnabledAgents } from "@/lib/api"

import { resolveDefaultAgent } from "@/lib/resolve-default-agent"

const source = (path: string) => readFileSync(resolve(path), "utf8")
const catalog = [...AGENT_DISPLAY_ORDER, "custom:legacy"].map(
  (agent_type, sort_order) =>
    ({
      agent_type,
      name: agent_type,
      enabled: true,
      available: true,
      sort_order,
    }) as AcpAgentInfo
)
const expected = [
  "claude_code",
  "codex",
  "grok",
  "pi",
  "deepseek",
  "antigravity",
]

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe("MaxCode six-agent maintenance scope", () => {
  it.each([acpListAgents, acpListEnabledAgents])(
    "exposes only maintained agents even against an older backend",
    async (query) => {
      mocks.call.mockResolvedValue(catalog)
      const agents = await query()
      expect(agents.map((agent) => agent.agent_type).sort()).toEqual(
        [...expected].sort()
      )
      expect(agents.map((agent) => agent.sort_order)).toEqual(
        [...agents.map((agent) => agent.sort_order)].sort((a, b) => a - b)
      )
      expect(catalog).toHaveLength(16)
    }
  )

  it("filters old cold-start caches without deleting legacy agent types", () => {
    saveEnabledAcpAgentsCache(catalog)
    expect(
      loadEnabledAcpAgentsCache()
        .map((agent) => agent.agent_type)
        .sort()
    ).toEqual([...expected].sort())
    expect(AGENT_DISPLAY_ORDER).toContain("gemini")
    expect(MAINTAINED_AGENT_TYPES).toHaveLength(6)
    expect(source("src/hooks/use-sorted-available-agents.ts")).toContain(
      "new Set<string>(MAINTAINED_AGENT_TYPES)"
    )
  })

  it("does not resurrect a hidden agent from saved defaults or old sessions", () => {
    expect(
      resolveDefaultAgent({
        lastSelected: "gemini",
        folderDefault: "open_code",
        inherit: "cline",
        sortedTypes: ["cursor", "grok"],
        fresh: true,
      })
    ).toEqual({ agentType: "grok", provisional: false })
    expect(
      resolveDefaultAgent({
        lastSelected: "custom:legacy",
        folderDefault: null,
        inherit: null,
        sortedTypes: ["cursor"],
        fresh: false,
      })
    ).toEqual({ agentType: "codex", provisional: true })
  })

  it("hides registration and excludes unsupported agents before backend work", () => {
    expect(ALLOW_CUSTOM_AGENT_REGISTRATION).toBe(false)
    const settings = source("src/components/settings/acp-agent-settings.tsx")
    expect(settings).toMatch(/ALLOW_CUSTOM_AGENT_REGISTRATION && \(\s*<Button/)
    expect(settings).toMatch(
      /ALLOW_CUSTOM_AGENT_REGISTRATION && \(\s*<AddCustomAgentDialog/
    )
    expect(source("src-tauri/src/commands/acp.rs")).toContain(
      ".filter(|agent| registry::is_maintained_agent(*agent))"
    )
    expect(source("src-tauri/src/commands/agent_auto_updates.rs")).toMatch(
      /for agent in registry::all_acp_agents\(\) \{\s*if !registry::is_maintained_agent\(agent\) \{\s*continue;/
    )
    const registry = source("src-tauri/src/acp/registry.rs")
    const policy = registry
      .split("pub fn is_maintained_agent")[1]
      .split("pub fn registry_id_for")[0]
    expect([...policy.matchAll(/AgentType::(\w+)/g)].map((m) => m[1])).toEqual([
      "Codex",
      "Grok",
      "DeepSeek",
      "Pi",
      "Antigravity",
      "ClaudeCode",
    ])
  })
})
