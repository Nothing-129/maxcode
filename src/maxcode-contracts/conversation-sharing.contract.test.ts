import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: read-only conversation sharing", () => {
  it("uses a revocable capability outside the authenticated API router", () => {
    const router = source("src-tauri/src/web/router.rs")
    const publicStart = router.indexOf("let public_api = Router::new()")
    const protectedStart = router.indexOf("let api = Router::new()")
    expect(protectedStart).toBeGreaterThanOrEqual(0)
    expect(publicStart).toBeGreaterThan(protectedStart)
    expect(router.slice(protectedStart, publicStart)).toContain(
      '"/create_conversation_share"'
    )
    expect(router.slice(publicStart)).toContain('"/shared_conversation"')

    const handler = source("src-tauri/src/web/handlers/conversation_share.rs")
    expect(handler).toContain('HeaderValue::from_static("private, no-store')
    expect(handler).toContain("POST is intentional")
  })

  it("publishes a path-free snapshot and burns revoked tokens", () => {
    const command = source("src-tauri/src/commands/conversation_share.rs")
    expect(command).toContain("pub struct SharedConversationSnapshot")
    expect(command).not.toMatch(/SharedConversationSnapshot[\s\S]*folder_id:/)
    expect(command).not.toMatch(/SharedConversationSnapshot[\s\S]*external_id:/)
    expect(command).not.toMatch(/SharedConversationSnapshot[\s\S]*origin_cwd:/)

    const service = source(
      "src-tauri/src/db/service/conversation_share_service.rs"
    )
    expect(service).toContain("if was_revoked")
    expect(service).toContain("active.token = Set(new_token())")
  })

  it("keeps credentials out of page URLs and exposes no composer", () => {
    const link = source("src/lib/conversation-share.ts")
    expect(link).toContain("/share#${token}")
    const view = source(
      "src/components/conversations/shared-conversation-view.tsx"
    )
    expect(view).toContain('fetch("/api/shared_conversation"')
    expect(view).toContain('method: "POST"')
    expect(view).not.toContain("MessageInput")
    expect(view).not.toContain("acp_prompt")
  })
})
