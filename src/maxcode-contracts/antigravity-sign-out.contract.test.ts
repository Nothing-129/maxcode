import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: Antigravity can leave a cached Google account safely", () => {
  it("exposes sign-out through the shared HTTP transport and the existing settings panel", () => {
    expect(source("src/lib/api.ts")).toContain(
      "export async function acpAntigravitySignOut"
    )
    expect(source("src-tauri/src/web/router.rs")).toContain(
      '"/acp_antigravity_sign_out"'
    )
    const panel = source("src/components/settings/antigravity-config-panel.tsx")
    expect(panel).toContain("function SignOut(")
    expect(panel).toContain("await acpAntigravitySignOut()")
  })

  it("quiesces Antigravity before logout and restores its saved auth method", () => {
    const commands = source("src-tauri/src/commands/acp.rs")
    const lock = commands.indexOf("lock_out_new_connections().await")
    const disconnect = commands.indexOf(
      "disconnect_by_agent_type(AgentType::Antigravity)",
      lock
    )
    const logout = commands.indexOf("antigravity_login::sign_out", disconnect)
    const sync = commands.indexOf("sync_antigravity_settings_for_env", logout)

    expect(lock).toBeGreaterThan(-1)
    expect(disconnect).toBeGreaterThan(lock)
    expect(logout).toBeGreaterThan(disconnect)
    expect(sync).toBeGreaterThan(logout)

    const manager = source("src-tauri/src/acp/manager.rs")
    expect(manager).toContain("pub async fn disconnect_by_agent_type")
    expect(manager).toContain('kill_tree_pass(pid, "SIGKILL")')
    expect(manager).toContain("draining")
  })

  it("keeps MaxCode dual-stream link discovery while adding ACP logout", () => {
    const login = source("src-tauri/src/acp/antigravity_login.rs")
    expect(login).toContain(
      "read_agent_stderr(stderr, Arc::clone(&tail), url_sink)"
    )
    expect(login).toContain("async fn await_start_signal(")
    expect(login).toContain('"method": "logout"')
    expect(login).toContain("advertises_logout(&handshake)")
    expect(login).toContain("claim_slot_as(SlotState::Finishing")
  })
})
