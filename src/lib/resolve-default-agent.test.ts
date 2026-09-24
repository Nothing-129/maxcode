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

  it("does not offer ZCode on a new conversation", () => {
    expect(
      resolveDefaultAgent({
        lastSelected: "zcode",
        folderDefault: "zcode",
        inherit: "zcode",
        sortedTypes: ["zcode", "grok"],
        fresh: true,
      })
    ).toEqual({ agentType: "grok", provisional: false })
    expect(
      resolveDefaultAgent({
        lastSelected: "zcode",
        folderDefault: null,
        inherit: null,
        sortedTypes: ["zcode"],
        fresh: true,
      })
    ).toEqual({ agentType: "codex", provisional: false })
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
