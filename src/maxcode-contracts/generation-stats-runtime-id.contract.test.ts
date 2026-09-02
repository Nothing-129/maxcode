import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const panel = readFileSync(
  resolve(
    process.cwd(),
    "src/components/conversations/conversation-detail-panel.tsx"
  ),
  "utf8"
)

describe("MaxCode contract: generation stats runtime identity", () => {
  it("rebinds a remounted persisted tab away from its stale virtual id", () => {
    const effectStart = panel.indexOf(
      "// Expose the runtime session key to the tab so composer/aux-panel consumers"
    )
    expect(effectStart).toBeGreaterThan(-1)

    const effectEnd = panel.indexOf("// Clear pendingCleanup", effectStart)
    expect(effectEnd).toBeGreaterThan(effectStart)
    const effect = panel.slice(effectStart, effectEnd)

    expect(effect).toContain("effectiveConversationId !== conversationId")
    expect(effect).toContain("ownTab?.runtimeConversationId != null")
    expect(effect).toContain("ownTab.runtimeConversationId !== conversationId")
    expect(effect).toContain(
      "setTabRuntimeConversationId(tabId, conversationId)"
    )
  })
})
