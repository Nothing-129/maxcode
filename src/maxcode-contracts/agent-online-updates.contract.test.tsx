import { readFileSync } from "node:fs"
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AgentUpdateBadge,
  useAgentUpdates,
} from "@/components/settings/agent-update-check"
import {
  buildVersionCheck,
  publishedUpgradeVersion,
} from "@/components/settings/acp-agent-settings"
import { acpCheckAgentUpdate, type AgentUpdateRelease } from "@/lib/api"
import { compareAgentVersions } from "@/lib/agent-update-status"
import type { AcpAgentInfo } from "@/lib/types"
import en from "@/i18n/messages/en.json"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const message =
      en.AgentUpdateSettings[key as keyof typeof en.AgentUpdateSettings]
    let text = typeof message === "string" ? message : key
    for (const [name, value] of Object.entries(values ?? {}))
      text = text.replace(`{${name}}`, value)
    return text
  },
}))
vi.mock("@/lib/api", () => ({ acpCheckAgentUpdate: vi.fn() }))

const agent = {
  agent_type: "codex",
  enabled: true,
  installed_version: "1.7.0",
  registry_version: "1.7.0",
  supports_custom_version: true,
  distribution_type: "npx",
  available: true,
  custom_source: null,
  env: {},
} as AcpAgentInfo
const latest: AgentUpdateRelease = { latestVersion: "1.10.0", source: "npm" }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe("online agent update contract", () => {
  it("checks enabled agents before selection and shares sidebar results with details", async () => {
    const enabled = { ...agent, enabled: true }
    const other = { ...enabled, agent_type: "grok" } as AcpAgentInfo
    const disabled = {
      ...agent,
      agent_type: "pi",
      enabled: false,
    } as AcpAgentInfo
    function Page({ installed = "1.7.0" }) {
      const agents = [
        { ...enabled, installed_version: installed },
        other,
        disabled,
      ]
      const updates = useAgentUpdates(agents)
      return (
        <>
          {agents.map((item) => (
            <AgentUpdateBadge
              key={item.agent_type}
              agent={item}
              updates={updates}
            />
          ))}
        </>
      )
    }
    vi.mocked(acpCheckAgentUpdate).mockImplementation(async (type) => {
      if (type === "grok") throw new Error("offline")
      return latest
    })
    const { rerender, container } = render(<Page />)
    await waitFor(() =>
      expect(
        container.querySelector('[data-agent-update-available="codex"]')
      ).not.toBeNull()
    )
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(2)
    expect(acpCheckAgentUpdate).not.toHaveBeenCalledWith("pi")
    expect(
      container.querySelector('[data-agent-update-available="grok"]')
    ).toBeNull()
    rerender(<Page installed="1.10.0" />)
    expect(
      container.querySelector('[data-agent-update-available="codex"]')
    ).toBeNull()
  })

  it("surfaces a published npm version on Version Status and installs it via Upgrade", () => {
    const check = buildVersionCheck(agent, true, {
      online: { loading: false, release: latest },
    })
    expect(check?.status).toBe("warn")
    expect(check?.message).toContain("Latest published: {version} ({source})")
    expect(check?.message).toContain("Upgrade available")
    expect(check?.fixes.some((fix) => fix.kind === "check_update")).toBe(true)
    expect(check?.fixes.some((fix) => fix.kind === "upgrade_npx")).toBe(true)
    expect(publishedUpgradeVersion(agent, latest)).toBe("1.10.0")

    const settings = readFileSync(
      "src/components/settings/acp-agent-settings.tsx",
      "utf8"
    )
    expect(settings).not.toContain("<AgentUpdateCheck")
    expect(settings).not.toContain("data-agent-update-check")
    expect(settings).toContain('action.kind === "check_update"')
    expect(settings).toContain("publishedUpgradeVersion(")
    expect(settings).toContain("installAgentVersion(agent, published)")
    expect(settings).toContain("setCustomInstallAgent(agent)")
  })

  it("shows loading and failure on Version Status rather than claiming latest", () => {
    const loading = buildVersionCheck(agent, true, {
      online: { loading: true },
    })
    expect(loading?.message).toContain("Checking the release source")
    expect(
      loading?.fixes.find((fix) => fix.kind === "check_update")
    ).toMatchObject({ disabled: true })

    const failed = buildVersionCheck(agent, true, {
      online: { loading: false, error: "offline" },
    })
    expect(failed?.message).toContain("Online check failed: {error}")
    expect(failed?.fixes.some((fix) => fix.kind === "upgrade_npx")).toBe(false)
  })

  it("caches per agent, bypasses cache on manual check, and re-compares after installation", async () => {
    vi.mocked(acpCheckAgentUpdate).mockResolvedValue(latest)
    const view = renderHook(({ agents }) => useAgentUpdates(agents), {
      initialProps: {
        agents: [
          agent,
          { ...agent, agent_type: "claude_code" } as AcpAgentInfo,
        ],
      },
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(2)
    await act(async () => {
      await view.result.current.check("codex", true)
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(3)
    expect(
      publishedUpgradeVersion({ ...agent, installed_version: "1.10.0" }, latest)
    ).toBeNull()
    const current = buildVersionCheck(
      { ...agent, installed_version: "1.10.0" },
      true,
      { online: { loading: false, release: latest } }
    )
    expect(current?.status).toBe("pass")
    expect(current?.fixes.some((fix) => fix.kind === "upgrade_npx")).toBe(false)
  })

  it("automatically checks every six hours and stops when disabled", async () => {
    vi.useFakeTimers()
    vi.mocked(acpCheckAgentUpdate).mockResolvedValue(latest)
    const view = renderHook(
      ({ enabled }) => useAgentUpdates([{ ...agent, enabled }]),
      {
        initialProps: { enabled: true },
      }
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1)
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(2)
    view.rerender({ enabled: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(2)
  })

  it("does not automatically check a disabled selection", async () => {
    vi.mocked(acpCheckAgentUpdate).mockResolvedValue(latest)
    renderHook(() => useAgentUpdates([{ ...agent, enabled: false }]))
    await act(async () => {
      await Promise.resolve()
    })
    expect(acpCheckAgentUpdate).not.toHaveBeenCalled()
  })

  it("expires cached releases after six hours on returning to an agent", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000)
    vi.mocked(acpCheckAgentUpdate).mockResolvedValue(latest)
    const view = renderHook(() => useAgentUpdates([agent]))
    await act(async () => {
      await Promise.resolve()
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(1)
    await act(async () => {
      await view.result.current.check("claude_code")
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(2)
    clock.mockReturnValue(1_000_000 + 6 * 60 * 60 * 1000)
    await act(async () => {
      await view.result.current.check("codex")
    })
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(3)
  })

  it("does not let a slow previous agent overwrite another agent's result", async () => {
    let finish!: (value: AgentUpdateRelease) => void
    vi.mocked(acpCheckAgentUpdate).mockImplementation(async (type) => {
      if (type === "codex")
        return new Promise((resolve) => {
          finish = resolve
        })
      return { latestVersion: "0.74.0", source: "npm" }
    })
    const view = renderHook(() =>
      useAgentUpdates([
        agent,
        { ...agent, agent_type: "claude_code" } as AcpAgentInfo,
      ])
    )
    await waitFor(() =>
      expect(
        view.result.current.states.claude_code?.release?.latestVersion
      ).toBe("0.74.0")
    )
    await act(async () => finish(latest))
    expect(view.result.current.states.claude_code?.release?.latestVersion).toBe(
      "0.74.0"
    )
    expect(view.result.current.states.codex?.release?.latestVersion).toBe(
      "1.10.0"
    )
  })

  it.each([null, "unknown", "build-deadbeef"])(
    "does not report an unknown local version (%s) as latest",
    (version) => {
      const check = buildVersionCheck(
        { ...agent, installed_version: version },
        true,
        { online: { loading: false, release: latest } }
      )
      if (!version) {
        expect(check?.fixes.some((fix) => fix.kind === "check_update")).toBe(
          false
        )
        return
      }
      expect(check?.message).toContain("Local version cannot be compared")
      expect(check?.message).not.toContain("At or above the published")
      expect(
        publishedUpgradeVersion(
          { ...agent, installed_version: version },
          latest
        )
      ).toBeNull()
    }
  )

  it("does not call a missing registry entry latest or install a different binary spec", () => {
    const missing = buildVersionCheck(agent, true, {
      online: {
        loading: false,
        release: { latestVersion: null, source: "acp" },
      },
    })
    expect(missing?.message).toContain("No online version information")
    expect(
      publishedUpgradeVersion(agent, { latestVersion: null, source: "acp" })
    ).toBeNull()

    const acpNewer = buildVersionCheck(agent, true, {
      online: { loading: false, release: { ...latest, source: "acp" } },
    })
    expect(acpNewer?.status).toBe("warn")
    expect(acpNewer?.fixes.some((fix) => fix.kind === "upgrade_npx")).toBe(true)
    expect(
      publishedUpgradeVersion(agent, { ...latest, source: "acp" })
    ).toBeNull()
  })

  it("routes read-only checks through the shared backend in both runtimes", () => {
    const source = (path: string) => readFileSync(path, "utf8")
    expect(source("src/lib/api.ts")).toContain(
      'call("acp_check_agent_update", { agentType })'
    )
    expect(source("src-tauri/src/web/router.rs")).toContain(
      "post(handlers::acp::acp_check_agent_update)"
    )
    const backend = source("src-tauri/src/commands/agent_updates.rs")
    expect(backend).toContain("reqwest::Url::parse(OFFICIAL_NPM_REGISTRY)")
    expect(backend).toContain("remote_registry::fetch_supported_agents()")
    expect(backend).toContain("Duration::from_secs(15)")
    expect(backend).not.toContain("Command::new")
    expect(backend).not.toContain("acp_prepare_npx_agent")
  })

  it.each([
    ["1.9.0", "1.10.0", false, -1],
    ["1.10.0-beta.2", "1.10.0", false, -1],
    ["1.10.0-beta.2", "1.10.0-beta.10", false, -1],
    ["v1.10.0+build", "1.10.0", false, 0],
    ["1.11.0", "1.10.0", false, 1],
    ["2026.8.1", "2026.8.1-2", true, -1],
    ["2026.8.1-2", "2026.8.1-1", true, 1],
    ["unknown", "1.0.0", false, null],
    ["1.0.0", "unknown", false, null],
  ] as const)(
    "compares %s against %s honestly",
    (local, remote, calendar, expected) => {
      expect(compareAgentVersions(local, remote, calendar)).toBe(expected)
    }
  )
})
