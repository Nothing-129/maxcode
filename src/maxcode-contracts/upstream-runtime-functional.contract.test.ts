import { describe, expect, it } from "vitest"

import { classifyToolKind } from "@/lib/adapters/tool-kind-classifier"
import { source } from "./contract-source"

describe("MaxCode contract: upstream runtime fixes preserve existing agent flows", () => {
  it("classifies pi tools through the existing tool groups", () => {
    expect(classifyToolKind("ls")).toBe("search")
    expect(classifyToolKind("powershell")).toBe("command")
    expect(classifyToolKind("bash")).toBe("command")
  })

  it("arms process cleanup before polling without losing exit ownership", () => {
    const vendor = source("src-tauri/src/acp/agent_process.rs")
    const monitor = vendor.slice(vendor.indexOf("fn monitor_child("))
    expect(vendor).not.toContain("async fn monitor_child(")
    expect(monitor.indexOf("let guard = ChildGuard")).toBeLessThan(
      monitor.indexOf("async move")
    )
    expect(vendor).toContain(
      "fn dropping_an_unpolled_child_monitor_still_reaps_and_reports_exit()"
    )
    expect(vendor).toContain(
      "fn a_child_that_survives_the_kill_keeps_its_pid_published()"
    )
  })

  it("keeps Antigravity waiting for stderr after stdout closes", () => {
    const login = source("src-tauri/src/acp/antigravity_login.rs")
    expect(login).toContain("await_start_signal(&mut url_rx, &mut responses)")
    expect(login).toContain(
      "read_agent_stderr(stderr, Arc::clone(&tail), url_sink)"
    )
    expect(login).toContain(
      "async fn stdout_eof_does_not_discard_a_later_stderr_sign_in_link()"
    )
    expect(login).toContain(
      "async fn start_signal_retains_cached_authentication_and_error_results()"
    )
    expect(login).toContain(".kill_on_drop(true)")
  })

  it("discovers pi extensions without adding a nonfunctional ACP assignment", () => {
    const mcp = source("src-tauri/src/commands/mcp.rs")
    expect(mcp).toContain(
      'LocalMcpReader::new("pi", McpAppType::Pi, read_pi_servers)'
    )
    expect(mcp).toContain("AgentType::Pi => Ok(BTreeMap::new())")
    expect(mcp).toContain(
      "fn pi_shared_server_edits_keep_extension_fields_but_replace_transport()"
    )
    expect(mcp).toContain("!TRANSPORT_KEYS.contains(&key.as_str())")
    expect(mcp).toContain(
      "next.entry(key.clone()).or_insert_with(|| value.clone())"
    )
    const settings = source("src/components/settings/mcp-settings.tsx")
    const options = settings.slice(
      settings.indexOf("const APP_OPTIONS:"),
      settings.indexOf("const SCAN_ONLY_APP_LABELS:")
    )
    expect(options).not.toContain('value: "pi"')
    expect(settings).toContain('pi: appSet.has("pi")')
    expect(settings).toContain("...hiddenLegacyApps")
    expect(source("src-tauri/src/acp/connection.rs")).toContain(
      "fn pi_startup_prelude_is_dropped_in_every_shape()"
    )
  })
})
