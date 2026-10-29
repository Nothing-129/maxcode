import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode send button color", () => {
  it("uses the send blue for both running stop buttons", () => {
    const input = source("src/components/chat/message-input.tsx")
    const stops = [
      ...input.matchAll(/<Button\s+onClick=\{onCancel\}[\s\S]*?<\/Button>/g),
    ]
    expect(stops).toHaveLength(2)
    for (const [stop] of stops) {
      expect(stop).toContain("bg-[#216ae4] text-white hover:bg-[#216ae4]/90")
      expect(stop).not.toMatch(/dark:(?:hover:)?bg-/)
      expect(stop).toContain('title={t("cancel")}')
      expect(stop).toContain('aria-label={t("cancel")}')
      expect(stop).toContain("<GenerationActionIcon running />")
    }
    expect(
      source("src/components/chat/composer/generation-action-icon.tsx")
    ).toContain("fill-current")
  })

  it("uses the action blue when enabled and muted paint when disabled", () => {
    const input = source("src/components/chat/message-input.tsx")
    const send = input.slice(
      input.indexOf("// MaxCode 发送钮"),
      input.indexOf("  return (", input.indexOf("// MaxCode 发送钮"))
    )
    expect(send).toContain("enabled:bg-[#216ae4]")
    expect(send).toContain("enabled:text-white")
    expect(send).toContain("enabled:hover:bg-[#216ae4]/90")
    expect(send).toContain("disabled:bg-muted")
    expect(send).not.toContain("disabled:bg-secondary")
    expect(send).toContain("disabled:text-muted-foreground")
    expect(send).toContain("disabled={sendDisabled}")
    expect(input).toContain(
      "(disabled && !(queueWhileUnavailable && onEnqueue)) || !hasSendableContent"
    )
  })
  it("uses a blue update icon and retains error red", () => {
    const update = source("src/components/layout/status-bar-update.tsx")
    expect(update).toContain("text-[#216ae4]")
    expect(update).not.toContain("bg-[#216ae4]")
    expect(update).toContain("statusBarActionClassName")
    expect(update).not.toMatch(/dark:(?:hover:)?bg-/)
    expect(update).toContain("text-destructive")
  })
})
