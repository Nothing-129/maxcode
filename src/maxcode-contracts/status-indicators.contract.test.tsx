import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ConversationUnreadDot } from "@/components/conversations/conversation-unread-dot"
import { source } from "./contract-source"

afterEach(cleanup)

describe("reference sidebar status indicators", () => {
  it("uses a small solid blue unread dot with an accessible label", () => {
    const { getByLabelText } = render(<ConversationUnreadDot label="Unread" />)
    expect(getByLabelText("Unread")).toHaveClass(
      "size-2",
      "rounded-full",
      "bg-[#3b82f6]"
    )
  })

  it("uses a thin neutral running ring with a rounded rotating arc", () => {
    const card = source(
      "src/components/conversations/sidebar-conversation-card.tsx"
    )
    const spinner = card.split("data-running-spinner")[1]?.split("</svg>")[0]
    expect(spinner).toContain("size-3 animate-spin text-[#858585]")
    expect(spinner).toContain('strokeOpacity="0.25"')
    expect(spinner).toContain('strokeWidth="1.5"')
    expect(spinner).toContain('strokeLinecap="round"')
  })
})
