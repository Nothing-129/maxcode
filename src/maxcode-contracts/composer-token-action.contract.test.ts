import { describe, expect, it } from "vitest"

import { composerTokenOpenTarget } from "@/components/chat/composer/composer-token-action"
import { source } from "./contract-source"

describe("MaxCode contract: composer right-click acts on the token", () => {
  it("keeps the existing composer menu and adds a token row above it", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain("onContextMenuCapture={handleComposerContextMenu}")
    expect(input).toContain("<ComposerTokenAction token={contextToken} />")
    expect(input).toContain("handleContextCut")
    expect(input).toContain("handleContextPaste")
    expect(input).toContain("pasteAsPlainText")
  })

  it("only offers an open row the shared opener can honor", () => {
    expect(
      composerTokenOpenTarget({
        kind: "url",
        value: "https://example.com",
        href: "https://example.com",
        start: 0,
        end: 18,
      })
    ).toBe("https://example.com")
    expect(
      composerTokenOpenTarget({
        kind: "url",
        value: "ftp://example.com",
        href: "ftp://example.com",
        start: 0,
        end: 16,
      })
    ).toBeNull()
  })
})
