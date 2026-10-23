import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: mobile workspace download handoff", () => {
  it("uses reusable scoped tickets and retains HTTP handoff coverage", () => {
    const handler = source("src-tauri/src/web/handlers/workspace_files.rs")
    expect(handler).toContain(
      ".issue_workspace_download_ticket(DownloadTicketSpec {"
    )
    expect(handler).toContain(".workspace_download_ticket(&ticket)")
    expect(handler).toContain(
      "workspace_download_survives_head_and_repeated_get"
    )
    expect(handler).toContain('["HEAD", "GET", "GET"]')
    expect(handler).toContain('HeaderValue::from_static("private, no-store")')
  })

  it("keeps expiry fixed and excludes single-use backup tickets", () => {
    const manager = source("src-tauri/src/workspace_transfer.rs")
    expect(manager).toContain(
      "ticket.reusable && Instant::now() < ticket.expires_at"
    )
    expect(manager).toContain(
      "workspace_ticket_retries_keep_scope_and_original_expiry"
    )
    const backup = source("src-tauri/src/web/handlers/backup.rs")
    expect(backup).toContain(".issue_download_ticket(DownloadTicketSpec {")
    expect(backup).toContain(".consume_download_ticket(&ticket)")
  })
})
