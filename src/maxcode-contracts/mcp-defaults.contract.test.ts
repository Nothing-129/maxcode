import { expect, it } from "vitest"
import { source } from "./contract-source"

it("runs the persisted MCP defaults contract in the Rust backend", () => {
  expect(source("src-tauri/src/commands/chat_authoring.rs")).toContain(
    "mcp-defaults.contract.rs"
  )
  const contract = source("src/maxcode-contracts/mcp-defaults.contract.rs")
  expect(contract).toContain(
    "missing_preferences_enable_automations_and_disable_questions"
  )
  expect(contract).toContain(
    "assert!(!load_question_settings(&db.conn).await.enabled)"
  )
  expect(source("src-tauri/src/commands/question.rs")).toMatch(
    /#\[derive\([^\]]*Default[^\]]*\)\]\s*pub struct QuestionSettings/
  )
})
