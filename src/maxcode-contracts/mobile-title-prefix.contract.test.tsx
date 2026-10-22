import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConversationTitleLabel } from "@/components/conversations/conversation-title-label"

describe("sidebar date and topic title", () => {
  it.each(["｜", "|", "丨"])(
    "shows date and topic on mobile and desktop for the %s separator",
    (separator) => {
      render(
        <ConversationTitleLabel
          title={`1022 ${separator} 探索 ${separator} E签宝OA审批文件上传`}
          fallback="Untitled"
        />
      )

      // Date stays visible at every viewport width, separated by an 8px gap.
      expect(screen.getByText("1022")).toHaveClass("w-[4ch]", "tabular-nums")
      expect(screen.getByText("1022")).not.toHaveClass("hidden")
      expect(screen.queryByText("｜")).toBeNull()
      expect(screen.getByText("1022")).toHaveClass(
        "text-xs",
        "text-muted-foreground"
      )
      expect(screen.getByText("1022").parentElement).toHaveClass("gap-2")
      expect(screen.queryByText(/探索/)).toBeNull()
      expect(screen.getByText("1022").parentElement?.textContent).toBe(
        "1022E签宝OA审批文件上传"
      )
      expect(screen.getByText("E签宝OA审批文件上传")).toHaveClass("truncate")
      expect(screen.getByText("E签宝OA审批文件上传")).not.toHaveClass("hidden")
    }
  )

  it.each([
    "普通会话标题",
    "1022｜探索",
    "项目｜探索｜审批文件",
    "1022/探索/审批文件",
  ])("preserves unstructured title %s", (title) => {
    render(<ConversationTitleLabel title={title} fallback="Untitled" />)
    expect(screen.getByText(title)).toHaveClass("truncate")
    expect(screen.getByText(title)).not.toHaveClass("hidden")
  })

  it("preserves the empty-title fallback", () => {
    render(<ConversationTitleLabel title={null} fallback="未命名会话" />)
    expect(screen.getByText("未命名会话")).not.toHaveClass("hidden")
  })
})
