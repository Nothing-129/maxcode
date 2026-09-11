import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConversationTitleLabel } from "./conversation-title-label"

describe("ConversationTitleLabel", () => {
  it("pins the MMDD prefix in a 4ch tabular column", () => {
    const { getByText } = render(
      <ConversationTitleLabel
        title="0911｜探索｜项目分析"
        fallback="Untitled"
        className="maxcode-sidebar-label font-[430]"
      />
    )
    const date = getByText("0911")
    expect(date).toHaveClass("w-[4ch]", "tabular-nums", "shrink-0")
    expect(getByText("｜探索｜")).toHaveClass("shrink-0")
    expect(getByText("项目分析")).toHaveClass("truncate")
    expect(date.parentElement).toHaveClass(
      "flex",
      "maxcode-sidebar-label",
      "font-[430]"
    )
    expect(date.parentElement).not.toHaveClass("truncate")
    expect(date.parentElement?.textContent).toBe("0911｜探索｜项目分析")
  })

  it("keeps skinny and wide dates in the same 4ch slot", () => {
    const { rerender } = render(
      <ConversationTitleLabel
        title="0911｜探索｜项目分析"
        fallback="Untitled"
      />
    )
    expect(screen.getByText("0911")).toHaveClass("w-[4ch]", "tabular-nums")
    rerender(
      <ConversationTitleLabel
        title="0830｜发布｜重新部署最新改动到服务"
        fallback="Untitled"
      />
    )
    expect(screen.getByText("0830")).toHaveClass("w-[4ch]", "tabular-nums")
  })

  it("keeps unstructured titles as one truncated string", () => {
    const { getByText } = render(
      <ConversationTitleLabel
        title="检查文字粗细差异"
        fallback="Untitled"
        className="maxcode-sidebar-label font-[430]"
      />
    )
    const title = getByText("检查文字粗细差异")
    expect(title).toHaveClass("truncate", "maxcode-sidebar-label", "font-[430]")
    expect(title.querySelector("[class*='tabular-nums']")).toBeNull()
  })

  it("uses the fallback when the title is empty", () => {
    const { getByText } = render(
      <ConversationTitleLabel title={null} fallback="Untitled conversation" />
    )
    expect(getByText("Untitled conversation")).toHaveClass("truncate")
  })
})
