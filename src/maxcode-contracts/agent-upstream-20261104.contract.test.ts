import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("reviewed November agent runtime integration", () => {
  it("registers executable session, steering, file-access and model contracts", () => {
    for (const [path, module] of [
      ["src-tauri/src/acp/connection.rs", "maxcode_agent_startup_steering"],
      [
        "src-tauri/src/acp/file_system_runtime.rs",
        "maxcode_antigravity_read_limit",
      ],
      ["src-tauri/src/parsers/pi.rs", "maxcode_pi_session_identity"],
      ["src-tauri/src/parsers/grok.rs", "maxcode_grok_context_inheritance"],
      ["src-tauri/src/commands/acp.rs", "maxcode_codex_gcp_provider"],
      [
        "src-tauri/src/acp/background_watch.rs",
        "maxcode_claude_mcp_command_ledger",
      ],
    ])
      expect(source(path)).toContain(`mod ${module};`)
  })

  it("keeps Codex predictions on the shared composer adoption path", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain("<AcceptPromptSuggestion")
    expect(input).toContain("useTouchSuggestion")
    expect(source("src-tauri/src/acp/connection.rs")).toContain(
      "apply_codex_prompt_suggestion_policy(agent_type, &mut merged_env, prompt_suggestions)"
    )
  })
})
