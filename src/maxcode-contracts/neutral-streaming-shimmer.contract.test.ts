import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

// Keep all conversation activity labels independent of the action palette.
const statusComponents = [
  "src/components/chat/async-task-strip.tsx",
  "src/components/message/agent-tool-call.tsx",
  "src/components/message/goal-tool-call.tsx",
  "src/components/message/delegation-status-row.tsx",
  "src/components/message/background-task-card.tsx",
  "src/components/message/content-parts-renderer.tsx",
  "src/components/message/agent-capsule.tsx",
  "src/components/message/codeg-mcp-tool-card.tsx",
  "src/components/ai-elements/reasoning.tsx",
]

describe("neutral conversation streaming highlights", () => {
  it.each(statusComponents)("uses a neutral highlight in %s", (path) => {
    const code = source(path)
    expect(code).toContain('shineColor="var(--foreground)"')
    expect(code).not.toContain('shineColor="var(--primary)"')
  })

  it("retains the looping sweep over muted text", () => {
    const code = source("src/components/ai-elements/shimmer.tsx")
    expect(code).toContain("var(--color-muted-foreground)")
    expect(code).toContain("repeat: Number.POSITIVE_INFINITY")
  })
})
