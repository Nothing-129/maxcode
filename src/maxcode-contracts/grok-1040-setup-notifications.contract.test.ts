import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

const connection = source("src-tauri/src/acp/connection.rs")

describe("MaxCode contract: Grok 1.0.40 setup notifications", () => {
  it("claims pre-session setup notifications before attaching a session", () => {
    const handler = connection.indexOf(
      "async move |_notif: GrokSessionSetupNotification"
    )
    const connect = connection.indexOf(".connect_with(agent")

    expect(handler).toBeGreaterThan(-1)
    expect(connect).toBeGreaterThan(handler)
    expect(connection).toContain(
      '#[notification(method = "_x.ai/session/setup")]'
    )
    expect(connection).toContain("session_id: Option<SessionId>")
    expect(connection).toContain(
      "fn grok_setup_notification_accepts_pre_session_null_id()"
    )
  })

  it("consumes the one-way MCP merge announcement", () => {
    const handler = connection.indexOf(
      "async move |_notif: GrokMcpServersUpdatedNotification"
    )
    const connect = connection.indexOf(".connect_with(agent")

    expect(handler).toBeGreaterThan(-1)
    expect(connect).toBeGreaterThan(handler)
    expect(connection).toContain(
      '#[notification(method = "_x.ai/mcp/servers_updated")]'
    )
    expect(connection).toContain(
      "fn grok_mcp_servers_updated_notification_matches_only_its_extension_method()"
    )
  })
})
