import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: stable structured session titles", () => {
  it("protects unlocked structured titles from transcript, native and index backfill", () => {
    const service = source("src-tauri/src/db/service/conversation_service.rs")
    expect(service).toContain(
      "would_downgrade_structured_title(&current, title)"
    )
    expect(service).toContain(
      "would_downgrade_structured_title(candidate, title)"
    )
    const refresh = service.slice(
      service.indexOf("pub async fn refresh_auto_title("),
      service.indexOf("fn would_downgrade_structured_title(")
    )
    expect(refresh).toContain(".filter(old_title)")
    expect(service).toContain(
      "async fn codex_index_preserves_structured_fallback()"
    )
    const tests = source("src-tauri/src/session_title_tests.rs")
    expect(tests).toContain(
      "async fn structured_title_survives_native_refresh_and_can_still_refine()"
    )
    expect(tests).toContain(
      "async fn recovered_title_is_returned_in_live_detail()"
    )
  })

  it("returns persisted title metadata after recovery", () => {
    const commands = source("src-tauri/src/commands/conversations.rs")
    const live = commands.slice(
      commands.indexOf("pub async fn get_folder_conversation_with_live_core("),
      commands.indexOf("/// One page of older history")
    )
    const reload = live.indexOf(
      "let current_summary = conversation_service::get_by_id"
    )
    expect(reload).toBeGreaterThan(live.indexOf("recover_auto_title("))
    expect(live).toContain("detail.summary.title = current_summary.title")
    expect(live).toContain(
      "detail.summary.title_locked = current_summary.title_locked"
    )
  })
})
