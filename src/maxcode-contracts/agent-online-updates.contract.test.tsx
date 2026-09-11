import { readFileSync } from "node:fs"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentUpdateCheck } from "@/components/settings/agent-update-check"
import { acpCheckAgentUpdate, type AgentUpdateRelease } from "@/lib/api"
import { compareAgentVersions } from "@/lib/agent-update-status"
import type { AcpAgentInfo } from "@/lib/types"
import en from "@/i18n/messages/en.json"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    let text =
      en.AgentUpdateSettings[key as keyof typeof en.AgentUpdateSettings] ?? key
    for (const [name, value] of Object.entries(values ?? {}))
      text = text.replace(`{${name}}`, value)
    return text
  },
}))
vi.mock("@/lib/api", () => ({ acpCheckAgentUpdate: vi.fn() }))

const agent = {
  agent_type: "codex",
  installed_version: "1.7.0",
  registry_version: "1.7.0",
  supports_custom_version: true,
} as AcpAgentInfo
const latest: AgentUpdateRelease = { latestVersion: "1.10.0", source: "npm" }

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe("online agent update contract", () => {
  it("checks automatically even at the built-in pin and requires explicit install confirmation", async () => {
    vi.mocked(acpCheckAgentUpdate).mockResolvedValue(latest)
    const onInstall = vi.fn()
    render(<AgentUpdateCheck agent={agent} onInstallVersion={onInstall} />)
    expect(acpCheckAgentUpdate).toHaveBeenCalledWith("codex")
    expect(await screen.findByText("An update is available.")).toBeVisible()
    expect(screen.getByText(/Latest published version: 1.10.0/)).toBeVisible()
    expect(onInstall).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole("button", { name: "Install 1.10.0…" })
    )
    expect(onInstall).toHaveBeenCalledWith("1.10.0")

    const settings = readFileSync(
      "src/components/settings/acp-agent-settings.tsx",
      "utf8"
    )
    expect(settings).toContain("<AgentUpdateCheck")
    expect(settings).toContain("setCustomVersionInput(version)")
    expect(settings).toContain("setCustomInstallAgent(selectedAgent)")
  })

  it("shows loading and failure, and allows a real retry rather than claiming latest", async () => {
    let reject!: (error: Error) => void
    vi.mocked(acpCheckAgentUpdate).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        })
    )
    render(<AgentUpdateCheck agent={agent} onInstallVersion={vi.fn()} />)
    expect(screen.getByText("Checking the release source…")).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Check for updates" })
    ).toBeDisabled()
    await act(async () => reject(new Error("offline")))
    expect(screen.getByText("Check failed: offline")).toBeVisible()
    expect(screen.queryByText(en.AgentUpdateSettings.current)).toBeNull()
    vi.mocked(acpCheckAgentUpdate).mockResolvedValueOnce(latest)
    await userEvent.click(
      screen.getByRole("button", { name: "Check for updates" })
    )
    expect(await screen.findByText("An update is available.")).toBeVisible()
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(2)
  })

  it("caches per agent, bypasses cache on manual check, and re-compares after installation", async () => {
    vi.mocked(acpCheckAgentUpdate).mockResolvedValue(latest)
    const onInstall = vi.fn()
    const { rerender } = render(
      <AgentUpdateCheck agent={agent} onInstallVersion={onInstall} />
    )
    await screen.findByText("An update is available.")
    rerender(
      <AgentUpdateCheck
        agent={{ ...agent, agent_type: "claude_code" }}
        onInstallVersion={onInstall}
      />
    )
    await waitFor(() => expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(2))
    await screen.findByText("An update is available.")
    rerender(<AgentUpdateCheck agent={agent} onInstallVersion={onInstall} />)
    await screen.findByText("An update is available.")
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(2)
    await userEvent.click(
      screen.getByRole("button", { name: "Check for updates" })
    )
    await waitFor(() => expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(3))
    rerender(
      <AgentUpdateCheck
        agent={{ ...agent, installed_version: "1.10.0" }}
        onInstallVersion={onInstall}
      />
    )
    expect(
      await screen.findByText(en.AgentUpdateSettings.current)
    ).toBeVisible()
    expect(screen.queryByRole("button", { name: "Install 1.10.0…" })).toBeNull()
  })

  it("expires cached releases after ten minutes on returning to an agent", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000)
    vi.mocked(acpCheckAgentUpdate).mockResolvedValue(latest)
    const onInstall = vi.fn()
    const { rerender } = render(
      <AgentUpdateCheck agent={agent} onInstallVersion={onInstall} />
    )
    await screen.findByText("An update is available.")
    rerender(
      <AgentUpdateCheck
        agent={{ ...agent, agent_type: "claude_code" }}
        onInstallVersion={onInstall}
      />
    )
    await screen.findByText("An update is available.")
    clock.mockReturnValue(1_000_000 + 10 * 60 * 1000)
    rerender(<AgentUpdateCheck agent={agent} onInstallVersion={onInstall} />)
    await screen.findByText("An update is available.")
    expect(acpCheckAgentUpdate).toHaveBeenCalledTimes(3)
  })

  it("does not let a slow previous agent overwrite the selected agent", async () => {
    let finish!: (value: AgentUpdateRelease) => void
    vi.mocked(acpCheckAgentUpdate)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValueOnce({ latestVersion: "0.74.0", source: "npm" })
    const { rerender } = render(
      <AgentUpdateCheck agent={agent} onInstallVersion={vi.fn()} />
    )
    rerender(
      <AgentUpdateCheck
        agent={{ ...agent, agent_type: "claude_code" }}
        onInstallVersion={vi.fn()}
      />
    )
    await screen.findByText(/Latest published version: 0.74.0/)
    await act(async () => finish(latest))
    expect(screen.queryByText(/Latest published version: 1.10.0/)).toBeNull()
  })

  it.each([null, "unknown", "build-deadbeef"])(
    "does not report an unknown local version (%s) as latest",
    async (version) => {
      vi.mocked(acpCheckAgentUpdate).mockResolvedValue(latest)
      render(
        <AgentUpdateCheck
          agent={{ ...agent, installed_version: version }}
          onInstallVersion={vi.fn()}
        />
      )
      expect(
        await screen.findByText(en.AgentUpdateSettings.unknown)
      ).toBeVisible()
      expect(screen.queryByText(en.AgentUpdateSettings.current)).toBeNull()
    }
  )

  it("does not call a missing registry entry latest or install a different binary spec", async () => {
    vi.mocked(acpCheckAgentUpdate).mockResolvedValueOnce({
      latestVersion: null,
      source: "acp",
    })
    render(<AgentUpdateCheck agent={agent} onInstallVersion={vi.fn()} />)
    expect(
      await screen.findByText(en.AgentUpdateSettings.unavailable)
    ).toBeVisible()
    vi.mocked(acpCheckAgentUpdate).mockResolvedValueOnce({
      ...latest,
      source: "acp",
    })
    await userEvent.click(
      screen.getByRole("button", { name: "Check for updates" })
    )
    await screen.findByText("An update is available.")
    expect(screen.queryByRole("button", { name: "Install 1.10.0…" })).toBeNull()
  })

  it("routes read-only checks through the shared backend in both runtimes", () => {
    const source = (path: string) => readFileSync(path, "utf8")
    expect(source("src/lib/api.ts")).toContain(
      'call("acp_check_agent_update", { agentType })'
    )
    expect(source("src-tauri/src/lib.rs")).toContain(
      "commands::agent_updates::acp_check_agent_update,"
    )
    expect(source("src-tauri/src/web/router.rs")).toContain(
      "post(handlers::acp::acp_check_agent_update)"
    )
    const backend = source("src-tauri/src/commands/agent_updates.rs")
    expect(backend).toContain("https://registry.npmjs.org/")
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
