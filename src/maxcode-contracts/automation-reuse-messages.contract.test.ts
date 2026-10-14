import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: persistent message automations", () => {
  it("registers executable Rust tests for the inbox and reusable native session", () => {
    expect(source("src-tauri/src/automation/engine.rs")).toContain(
      "mod maxcode_automation_reuse_messages_contract;"
    )
    expect(source("src-tauri/src/automation/messages.rs")).toContain(
      "mod maxcode_automation_message_stream_contract;"
    )
    expect(source("src-tauri/src/db/migration/mod.rs")).toContain(
      "m20261013_000001_automation_message::Migration"
    )
  })
  it("keeps the saved composer snapshot compatible with existing automations", () => {
    const model = source("src-tauri/src/models/automation.rs")
    expect(model).toContain("NewPerRun,")
    expect(model).toContain("pub session_mode: AutomationSessionMode")
    expect(model).toContain(
      "pub message_trigger: Option<AutomationMessageTrigger>"
    )
  })
})
