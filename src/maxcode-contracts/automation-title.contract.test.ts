import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: automation conversation titles", () => {
  it("keeps automation runs date-prefixed, identifiable, and parser-proof", () => {
    const engine = source("src-tauri/src/automation/engine.rs")

    expect(engine).toContain(
      "automation_conversation_title(&auto.name, Utc::now())"
    )
    expect(engine).toContain("with_timezone(&Shanghai)")
    expect(engine).toContain('format!("{date}｜自动｜{}", name.trim())')
    expect(engine).toContain("conversation_service::lock_title")
  })
})
