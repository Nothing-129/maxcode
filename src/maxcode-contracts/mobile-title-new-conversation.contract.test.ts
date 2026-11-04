import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("conversation title action", () => {
  it("creates a draft in the displayed conversation's folder on mobile and PC without treating a drag as a click", () => {
    const header = source(
      "src/components/conversations/conversation-detail-header.tsx"
    )
    const title = header.slice(
      header.indexOf('data-conversation-title=""'),
      header.indexOf("<ConversationTitleLabel")
    )
    expect(title).toContain("onClick={(event) => {")
    expect(title).toContain(
      "event.button !== 0 || titleDragged.current || !folderPath"
    )
    expect(title).toContain("openNewConversationTab(folderId, folderPath)")
    expect(title).not.toContain("window.innerWidth")
    expect(header).toContain("titleDragged.current = true")
    expect(title).toContain("titleDragged.current = false")
    expect(title).toContain("handleTitleDrag(event)")
    expect(title).toContain("closePane(tabId)")
  })
})
