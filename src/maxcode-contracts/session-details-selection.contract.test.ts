import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("MaxCode: selectable session details", () => {
  it("opts the full details body into text selection inside the non-selectable sidebar", () => {
    const content = readFileSync(
      "src/components/conversations/session-details-content.tsx",
      "utf8"
    )
    expect(content).toMatch(
      /<div className="[^"]*@container[^"]*\bselect-text\b[^"]*">/
    )
  })
})
