import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AcpAgentInfo } from "@/lib/types"
import { useAgentAutoUpdateStatus } from "@/components/settings/agent-auto-update"
import { buildVersionCheck } from "@/components/settings/acp-agent-settings"

const api = vi.hoisted(() => ({ status: vi.fn() }))
vi.mock("@/lib/api", () => ({ acpAgentAutoUpdateStatus: api.status }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8")
const agent = { agent_type: "codex", enabled: true, env: {} } as AcpAgentInfo

describe("MaxCode automatic agent updates", () => {
  it("shows the official CLI separately when the adapter version is unchanged", () => {
    const check = buildVersionCheck(
      {
        ...agent,
        distribution_type: "npx",
        available: true,
        installed_version: "1.12.0",
        registry_version: "1.12.0",
        custom_source: null,
      } as AcpAgentInfo,
      true,
      {
        autoUpdate: {
          phase: "waiting",
          version: "1.12.0",
          runtimeVersion: "0.154.0",
          runtimeLatestVersion: "0.155.0",
          error: null,
        },
      }
    )
    expect(check?.message).toContain("Native CLI: {installed}")
    expect(check?.message).toContain("latest official: {latest}")
    expect(check?.message).toContain("waiting for sessions")
  })
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
    const view = renderHook(() =>
      useAgentAutoUpdateStatus({
        ...agent,
        agent_type: agentType,
        env: { MAXCODE_AGENT_AUTO_UPDATE: "false" },
      } as AcpAgentInfo)
    )
    await waitFor(() => expect(view.result.current?.phase).toBe("waiting"))
    expect(view.result.current?.version).toBe("1.10.1")
    const check = buildVersionCheck(
      {
        ...agent,
        agent_type: agentType as AcpAgentInfo["agent_type"],
        distribution_type: "npx",
        available: true,
        installed_version: "1.7.0",
        registry_version: "1.7.0",
        custom_source: null,
        env: {},
      } as AcpAgentInfo,
      true,
      {
        autoUpdate: { phase: "waiting", version: "1.10.1", error: null },
      }
    )
    expect(check?.message).toContain("waiting for sessions")
    expect(check?.message).toContain("1.10.1")
    const worker = source("src-tauri/src/commands/agent_auto_updates.rs")
    expect(worker).toContain(
      "setting.enabled && setting.installed_version.is_some()"
    )
    expect(worker).not.toContain("AUTO_UPDATE_ENV")
    expect(worker).not.toContain("build_runtime_env_from_setting")
    const settings = source("src/components/settings/acp-agent-settings.tsx")
    expect(settings).toContain("useAgentAutoUpdateStatus")
    expect(settings).not.toContain("<AgentAutoUpdate")
    expect(settings).not.toContain("data-agent-auto-update")
  })
  it("reports backend failures and does not poll disabled agents", async () => {
    api.status.mockRejectedValue(new Error("server unavailable"))
    const view = renderHook(() => useAgentAutoUpdateStatus(agent))
    await waitFor(() => expect(view.result.current?.phase).toBe("error"))
    expect(view.result.current?.error).toContain("server unavailable")
    view.unmount()
    api.status.mockClear()
    const disabled = renderHook(() =>
      useAgentAutoUpdateStatus({
        ...agent,
        agent_type: "claude_code",
        enabled: false,
      } as AcpAgentInfo)
    )
    expect(disabled.result.current).toBeNull()
    expect(api.status).not.toHaveBeenCalled()
  })
  it("runs in both backends and isolates downloads from activation and manual actions", () => {
    const worker = source("src-tauri/src/commands/agent_auto_updates.rs")
    expect(worker).toContain("for agent in registry::all_acp_agents()")
    expect(worker).toContain("prepare_binary(agent, version, &root)")
    expect(worker).toContain("prepare_python(agent, version, &root)")
    expect(worker).toContain("Duration::from_secs(6 * 60 * 60)")
    expect(worker).toContain("--registry={OFFICIAL_NPM_REGISTRY}")
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
    const acp = source("src-tauri/src/commands/acp.rs")
    expect(acp).toContain("agent_auto_updates::active_command(cmd)")
    expect(acp).toContain("agent_auto_updates::INSTALL_LOCK.lock().await")
    expect(acp).toContain("agent_auto_updates::clear_active(agent_type)")
    expect(source("src-tauri/src/web/router.rs")).toContain(
      '"/acp_agent_auto_update_status"'
    )
  })
})
