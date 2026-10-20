import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode reviewed upstream runtime October 15", () => {
  it("registers executable runtime, feedback and transcript contracts", () => {
    for (const [file, module] of [
      ["connection", "maxcode_upstream_runtime_20261015_contract"],
      ["delegation/companion", "maxcode_upstream_feedback_20261015_contract"],
      ["background_watch", "maxcode_upstream_watch_20261015_contract"],
    ]) {
      expect(source(`src-tauri/src/acp/${file}.rs`)).toContain(`mod ${module};`)
    }
  })

  it("keeps relocated history on the maintained native parsers", () => {
    const parsers = source("src-tauri/src/parsers/mod.rs")
    for (const [agent, parser] of [
      ["ClaudeCode", "claude::ClaudeParser"],
      ["Codex", "codex::CodexParser"],
      ["Grok", "grok::GrokParser"],
      ["Pi", "pi::PiParser"],
      ["DeepSeek", "deepseek::DeepSeekParser"],
      ["Antigravity", "antigravity::AntigravityParser"],
    ]) {
      expect(parsers).toContain(
        `AgentType::${agent} => Box::new(${parser}::for_env(env))`
      )
    }
    expect(source("src-tauri/src/db/service/import_service.rs")).toContain(
      "AgentType::Zcode"
    )
  })
})
