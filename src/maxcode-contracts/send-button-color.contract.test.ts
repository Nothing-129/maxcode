import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode send button color", () => {
  it("uses the wordmark blue when enabled and muted paint when disabled", () => {
    const input = source("src/components/chat/message-input.tsx")
    const send = input.slice(
      input.indexOf("// MaxCode 发送钮"),
      input.indexOf("  return (", input.indexOf("// MaxCode 发送钮"))
    )
    const wordmark = source("src/components/layout/sidebar-wordmark.tsx")

    expect(wordmark).toContain("text-[#285ee1]")
    expect(send).toContain("enabled:bg-[#285ee1]")
    expect(send).toContain("enabled:text-white")
    expect(send).toContain("enabled:hover:bg-[#285ee1]/90")
    expect(send).toContain("disabled:bg-secondary")
    expect(send).toContain("disabled:text-muted-foreground")
    expect(send).toContain("disabled={disabled || !hasSendableContent}")
  })
})
