import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: no background task strip above chat", () => {
  it("keeps the shared chat shell free of the task strip on every surface", () => {
    const shell = source("src/components/chat/conversation-shell.tsx")
    expect(shell).not.toContain("AsyncTaskStrip")
    expect(shell).not.toContain("@/components/chat/async-task-strip")
    expect(shell).toContain("{children}")

    for (const path of [
      "src/components/conversations/conversation-detail-panel.tsx",
      "src/components/canvas/canvas-conversation-surface.tsx",
    ]) {
      const surface = source(path)
      expect(surface).toContain("<ConversationShell")
      expect(surface).not.toContain("AsyncTaskStrip")
    }
  })
})
