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
      expect(stop).toContain("bg-[#3ca1ef] text-white hover:bg-[#3ca1ef]/90")
      expect(stop).toContain('title={t("cancel")}')
      expect(stop).toContain("fill-current")
    }
  })

  it("uses the action blue when enabled and muted paint when disabled", () => {
    const input = source("src/components/chat/message-input.tsx")
    const send = input.slice(
      input.indexOf("// MaxCode 发送钮"),
      input.indexOf("  return (", input.indexOf("// MaxCode 发送钮"))
    )
    expect(send).toContain("enabled:bg-[#3ca1ef]")
    expect(send).toContain("enabled:text-white")
    expect(send).toContain("enabled:hover:bg-[#3ca1ef]/90")
    expect(send).toContain("disabled:bg-secondary")
    expect(send).toContain("disabled:text-muted-foreground")
    expect(send).toContain("disabled={disabled || !hasSendableContent}")
  })
  it("uses the same update blue in light and dark modes", () => {
    const update = source("src/components/layout/status-bar-update.tsx")
    expect(update).toContain("bg-[#3ca1ef] text-white hover:bg-[#3ca1ef]/90")
    expect(update).not.toMatch(/dark:(?:hover:)?bg-/)
    expect(update).toContain(
      "bg-destructive text-white hover:bg-destructive/90"
    )
  })
})
