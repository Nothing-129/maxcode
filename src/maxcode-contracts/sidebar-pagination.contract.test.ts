import { describe, expect, it } from "vitest"

import { RECENT_PAGE_SIZE } from "@/components/conversations/sidebar-conversation-grouping"
import { source } from "./contract-source"

describe("MaxCode contract: Recent and Chat reveal ten items per page", () => {
  it("keeps the initial limits and reveal increments at ten", () => {
    expect(RECENT_PAGE_SIZE).toBe(10)
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(
      list.match(/t\("showMoreConversations", \{ count: row.remaining \}\)/g)
    ).toHaveLength(3)
    expect(list).toContain("const FOLDER_PAGE_SIZE = 10")
    expect(list).toContain("const CHAT_PAGE_SIZE = FOLDER_PAGE_SIZE")
    for (const [section, constant] of [
      ["Chat", "CHAT_PAGE_SIZE"],
      ["Recent", "RECENT_PAGE_SIZE"],
    ]) {
      expect(list).toContain(`useState(${constant})`)
      expect(list).toContain(`set${section}Limit((n) => n + ${constant})`)
    }
    expect(list).toContain("        chatLimit,")
    expect(list).toContain("        recentLimit,")
    expect(list).toContain(
      'if (section === "recent") setRecentLimit(RECENT_PAGE_SIZE)'
    )
  })
})
