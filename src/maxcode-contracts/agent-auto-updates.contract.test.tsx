import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider } from "next-intl"
import messages from "@/i18n/messages/en.json"
import type { AcpAgentInfo } from "@/lib/types"
import { AgentAutoUpdate } from "@/components/settings/agent-auto-update"

const api = vi.hoisted(() => ({ status: vi.fn() }))
vi.mock("@/lib/api", () => ({ acpAgentAutoUpdateStatus: api.status }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8")
const agent = { agent_type: "codex", enabled: true, env: {} } as AcpAgentInfo
function mount(info = agent) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AgentAutoUpdate agent={info} />
    </NextIntlClientProvider>
  )
}

describe("MaxCode automatic agent updates", () => {
  it.each([
    "codex",
    "grok",
    "claude_code",
    "gemini",
    "opencode",
    "custom:python-agent",
  ])("shows mandatory automatic updates for enabled %s", async (agentType) => {
    api.status.mockResolvedValue({
      phase: "waiting",
      version: "1.10.1",
      error: null,
    })
    mount({
      ...agent,
      agent_type: agentType,
      env: { MAXCODE_AGENT_AUTO_UPDATE: "false" },
    } as AcpAgentInfo)
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "waiting for sessions"
      )
    )
    expect(screen.queryByRole("switch")).toBeNull()
    const worker = source("src-tauri/src/commands/agent_auto_updates.rs")
    expect(worker).toContain(
      "setting.enabled && setting.installed_version.is_some()"
    )
    expect(worker).not.toContain("AUTO_UPDATE_ENV")
    expect(worker).not.toContain("build_runtime_env_from_setting")
  })
  it("reports backend failures and does not poll disabled agents", async () => {
    api.status.mockRejectedValue(new Error("server unavailable"))
    const view = mount()
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "server unavailable"
      )
    )
    view.unmount()
    api.status.mockClear()
    mount({
      ...agent,
      agent_type: "claude_code",
      enabled: false,
    } as AcpAgentInfo)
    expect(screen.queryByRole("switch")).toBeNull()
    expect(api.status).not.toHaveBeenCalled()
  })
  it("runs in both backends and isolates downloads from activation and manual actions", () => {
    const worker = source("src-tauri/src/commands/agent_auto_updates.rs")
    expect(worker).toContain("for agent in registry::all_acp_agents()")
    expect(worker).toContain("prepare_binary(agent, version, &root)")
    expect(worker).toContain("prepare_python(agent, version, &root)")
    expect(worker).toContain("Duration::from_secs(6 * 60 * 60)")
    expect(worker).toContain("--registry={AGENT_NPM_REGISTRY}")
    expect(worker).toContain("--prefix={}")
    expect(worker).toContain(
      'cmd.env("GROK_HOME", prefix.join("grok-runtime"))'
    )
    expect(worker).toContain('cli.args(["cli", "--version"])')
    expect(worker).toContain("live_or_draining_agent_names()")
    expect(worker).toContain(
      "INSTALL_REVISION.load(Ordering::SeqCst) != revision"
    )
    expect(worker).toContain('file.persist(root.join("active.json"))')
    expect(worker).not.toContain("uninstall_npm_global_package")
    expect(source("src-tauri/src/bin/codeg_server.rs")).toContain(
      "agent_auto_updates::run("
    )
    expect(source("src-tauri/src/lib.rs")).toContain("agent_auto_updates::run(")
    const acp = source("src-tauri/src/commands/acp.rs")
    expect(acp).toContain("agent_auto_updates::active_command(cmd)")
    expect(acp).toContain("agent_auto_updates::INSTALL_LOCK.lock().await")
    expect(acp).toContain("agent_auto_updates::clear_active(agent_type)")
    expect(source("src-tauri/src/web/router.rs")).toContain(
      '"/acp_agent_auto_update_status"'
    )
  })
})
