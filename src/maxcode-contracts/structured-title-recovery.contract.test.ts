import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: structured title recovery", () => {
  it("generates date/topic titles and accepts legacy categories on read", () => {
    const titles = source("src-tauri/src/session_title.rs")
    const tests = source("src-tauri/src/session_title_tests.rs")
    expect(titles).toContain("只生成主题，不要日期或类型")
    expect(titles).not.toContain("TITLE_CATEGORY_GUIDANCE")
    expect(tests).toContain("fn date_topic_and_fallback_apply_to_every_locale")
    expect(tests).toContain(
      "fn other_category_accepts_topics_and_normalizes_legacy_fallbacks"
    )
  })

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
    expect(titles).toContain("title model HTTP request sending")
    expect(titles).toContain("title model HTTP response received")
    expect(titles).toContain("title model generation completed")
    expect(titles).toContain("commit_refined_title")
    expect(titles).toContain("normalize_structured_title")
    expect(titles).toContain("tracing::error!(conversation_id")
  })

  it("keeps executable Rust regressions for retries, locks and original context", () => {
    const tests = source("src-tauri/src/session_title_tests.rs")
    for (const name of [
      "structured_title_normalizes_separators_and_created_date",
      "invalid_responses_retry_but_authentication_does_not",
      "greeting_kickoff_calls_http_for_each_supported_agent",
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
