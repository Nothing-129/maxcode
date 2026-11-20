import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("conversation header title format", () => {
  it("uses the topic in the title and tooltip without rewriting stored titles", () => {
    const header = readFileSync(
      "src/components/conversations/conversation-detail-header.tsx",
      "utf8"
    )
    expect(header).toMatch(
      /<ConversationTitleLabel\s+(?:showDate=\{false\}\s+)?title=\{headerTitle\}/
    )
    expect(header).toContain('fallback={t("untitledConversation")}')
    expect(header).toContain("setRenameValue(conversationTitleTopic(title))")
    expect(header).toContain("title={displayTitle}")
  })
})
