import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: daily automation chats", () => {
  it("registers executable Rust coverage for task timezone day boundaries", () => {
    expect(
      source("src-tauri/src/db/service/automation_runtime_service.rs")
    ).toContain("mod maxcode_automation_daily_chat_contract;")
  })

  it("explains daily reuse and task timezone in the automation editor", () => {
    const messages = JSON.parse(source("src/i18n/messages/zh-CN.json"))
    const english = JSON.parse(source("src/i18n/messages/en.json"))
    expect(messages.Automations.sessionReuse).toBe("每天一个对话")
    expect(messages.Automations.sessionReuseHint).toContain("按任务时区")
    expect(english.Automations.sessionReuse).toBe("One chat per day")
    expect(english.Automations.sessionReuseHint).toContain("task’s timezone")
  })
})
