import { describe, expect, it } from "vitest"
import { resolveDefaultAgent } from "@/lib/resolve-default-agent"

describe("resolveDefaultAgent", () => {
  it("prefers the last user-selected agent across folder defaults", () => {
    expect(
      resolveDefaultAgent({
        lastSelected: "codex",
        folderDefault: "claude_code",
        inherit: "gemini",
        sortedTypes: ["open_code"],
        fresh: true,
      })
    ).toEqual({ agentType: "codex", provisional: false })
  })

  it("keeps ZCode available as a remembered or sole new-conversation agent", () => {
    expect(
      resolveDefaultAgent({
        lastSelected: "zcode",
        folderDefault: "zcode",
        inherit: "zcode",
        sortedTypes: ["zcode", "grok"],
        fresh: true,
      })
    ).toEqual({ agentType: "zcode", provisional: false })
    expect(
      resolveDefaultAgent({
        lastSelected: "zcode",
        folderDefault: null,
        inherit: null,
        sortedTypes: ["zcode"],
        fresh: true,
      })
    ).toEqual({ agentType: "zcode", provisional: false })
  })

  it("keeps the existing folder default before any user selection", () => {
    expect(
      resolveDefaultAgent({
        lastSelected: null,
        folderDefault: "claude_code",
        inherit: "gemini",
        sortedTypes: ["open_code"],
        fresh: true,
      })
    ).toEqual({ agentType: "claude_code", provisional: false })
  })
})
