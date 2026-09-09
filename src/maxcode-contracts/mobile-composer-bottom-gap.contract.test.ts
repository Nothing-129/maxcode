import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("phone composer bottom spacing", () => {
  it("reserves the system safe area once at the workspace boundary", () => {
    const workspace = source("src/app/workspace/layout.tsx")
    const composer = source("src/components/chat/chat-input.tsx")
    expect(workspace).toContain("pb-[env(safe-area-inset-bottom)]")
    expect(composer).not.toContain("env(safe-area-inset-bottom)")
    expect(composer).toContain('flush ? "pb-1" : "px-4 pb-2 md:pb-3"')
  })
})
