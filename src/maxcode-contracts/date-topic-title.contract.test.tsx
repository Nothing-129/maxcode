import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConversationTitleLabel } from "@/components/conversations/conversation-title-label"
import {
  formatConversationTitle,
  parseStructuredConversationTitle,
} from "@/lib/conversation-title"
import { source } from "./contract-source"

describe("date/topic titles without categories", () => {
  it.each([
    "1102｜设计｜委托批次与数据权限",
    "1102 | 设计 | 委托批次与数据权限",
    "1102｜委托批次与数据权限",
  ])("normalizes %s for display and editing", (title) => {
    expect(formatConversationTitle(title)).toBe("1102｜委托批次与数据权限")
    render(<ConversationTitleLabel title={title} fallback="未命名" />)
    expect(screen.getByText("1102")).toHaveClass("tabular-nums")
    expect(screen.getByText("委托批次与数据权限")).toHaveClass("truncate")
    expect(screen.queryByText(/设计/)).toBeNull()
  })

  it("preserves topic slashes, references and ordinary titles", () => {
    expect(formatConversationTitle("1102｜CI/CD")).toBe("1102｜CI/CD")
    expect(formatConversationTitle("1102｜设计｜[权限](file:///tmp/a)")).toBe(
      "1102｜权限"
    )
    expect(formatConversationTitle("讨论设计方案")).toBe("讨论设计方案")
    expect(parseStructuredConversationTitle("1102｜CI/CD")).toEqual({
      date: "1102",
      kind: "",
      topic: "CI/CD",
    })
  })

  it("keeps creation dates out of model instructions and assembles them locally", () => {
    const backend = source("src-tauri/src/session_title.rs")
    const prompt = backend.slice(
      backend.indexOf("pub fn title_prompt("),
      backend.indexOf("fn title_prompt_for_message(")
    )
    expect(prompt).not.toContain("created_at")
    expect(prompt).not.toContain("MMDD")
    expect(prompt).toContain("只生成主题，不要日期或类型")
    expect(backend).toContain("title_from_model(&title, created_at)")
    expect(source("src-tauri/src/session_title_tests.rs")).toContain(
      "async fn model_generates_only_topic_and_creation_date_is_added_locally"
    )
  })

  it("opens both rename dialogs with the same normalized title", () => {
    expect(
      source("src/components/conversations/conversation-detail-header.tsx")
    ).toContain("setRenameValue(formatConversationTitle(title))")
    expect(
      source("src/components/conversations/sidebar-conversation-card.tsx")
    ).toContain("setRenameValue(formatConversationTitle(conversation.title))")
  })
})
