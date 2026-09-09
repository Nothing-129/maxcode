import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("running composer actions", () => {
  it("keeps all running actions circular and visually separate", () => {
    const input = source("src/components/chat/message-input.tsx")
    const running = input.slice(
      input.indexOf(") : isPrompting && onCancel ? ("),
      input.indexOf("// MaxCode 发送钮")
    )

    expect(running.match(/h-8 w-8 rounded-full/g)).toHaveLength(4)
    expect(running.match(/size-3.5 fill-current/g)).toHaveLength(2)
    expect(running).toContain('<ArrowUp className="size-4"')
    expect(running).toContain('variant="secondary"')
    expect(running).toContain('variant="ghost"')
    expect(running).not.toMatch(/rounded-[rl]-none|border-l|destructive|<Send/)
  })
})
