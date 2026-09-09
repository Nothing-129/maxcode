import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: structured title recovery", () => {
  it("recovers from the original transcript before pagination, protecting names", () => {
    const commands = source("src-tauri/src/commands/conversations.rs")
    const start = commands.indexOf(
      "pub async fn get_folder_conversation_with_live_core"
    )
    const body = commands.slice(start)
    expect(body).toContain(
      "recover_auto_title(conn, emitter, &detail.summary, &detail.turns)"
    )
    expect(body.indexOf("recover_auto_title(")).toBeLessThan(
      body.indexOf("apply_turn_window(")
    )
    const titles = source("src-tauri/src/session_title.rs")
    expect(titles).toContain("summary.title_locked")
    expect(titles).toContain("TITLE_RECOVERY_COOLDOWN")
    expect(titles).toContain("commit_refined_title")
    expect(titles).toContain("normalize_structured_title")
    expect(titles).toContain("tracing::error!(conversation_id")
  })

  it("keeps executable Rust regressions for retries, locks and original context", () => {
    const tests = source("src-tauri/src/session_title_tests.rs")
    for (const name of [
      "structured_title_normalizes_separators_and_created_date",
      "invalid_responses_retry_but_authentication_does_not",
      "recovery_uses_original_context_and_preserves_locked_titles",
      "fallback_stays_unlocked_and_cooldown_prevents_request_storms",
      "manual_refresh_image_only_message_sends_reply_context",
      "structured_fallback_covers_empty_text_images_and_model_failures",
    ]) {
      expect(tests).toContain(
        `async fn ${name}`.replace("async fn structured", "fn structured")
      )
    }
    expect(tests).toContain(
      "fn image_only_title_uses_first_reply_without_crossing_user_turns"
    )
  })
})
