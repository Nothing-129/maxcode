import { beforeEach, describe, expect, it } from "vitest"
import {
  CHAT_AGENT_MEMORY_SCOPE,
  getLastSelectedAgent,
  saveLastSelectedAgent,
} from "@/lib/last-selected-agent-storage"

describe("last-selected-agent-storage (scoped)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("keeps each project folder's memory independent", () => {
    saveLastSelectedAgent("/Users/x/project-a", "codex")
    saveLastSelectedAgent("/Users/x/project-b", "gemini")

    expect(getLastSelectedAgent("/Users/x/project-a")).toBe("codex")
    expect(getLastSelectedAgent("/Users/x/project-b")).toBe("gemini")
  })

  it("keeps the chat scope separate from project scopes", () => {
    saveLastSelectedAgent("/Users/x/project-a", "codex")
    saveLastSelectedAgent(CHAT_AGENT_MEMORY_SCOPE, "claude_code")

    expect(getLastSelectedAgent(CHAT_AGENT_MEMORY_SCOPE)).toBe("claude_code")
    expect(getLastSelectedAgent("/Users/x/project-a")).toBe("codex")
  })

  it("returns null for a scope with no saved choice", () => {
    saveLastSelectedAgent("/Users/x/project-a", "codex")

    expect(getLastSelectedAgent("/Users/x/other")).toBeNull()
  })

  it("overwrites the same scope on a newer choice", () => {
    saveLastSelectedAgent("/Users/x/project-a", "codex")
    saveLastSelectedAgent("/Users/x/project-a", "gemini")

    expect(getLastSelectedAgent("/Users/x/project-a")).toBe("gemini")
  })

  it("does not leak between the legacy global key and v2 scopes", () => {
    localStorage.setItem("codeg:last-selected-agent:v1", "claude_code")
    saveLastSelectedAgent("/Users/x/project-a", "codex")

    expect(getLastSelectedAgent("/Users/x/project-a")).toBe("codex")
    expect(getLastSelectedAgent("/Users/x/project-b")).toBeNull()
  })
})
