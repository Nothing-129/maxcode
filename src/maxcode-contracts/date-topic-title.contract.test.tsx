import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import { ConversationTitleLabel } from "@/components/conversations/conversation-title-label"
import { SessionDetailsDialog } from "@/components/conversations/session-details-dialog"
import enMessages from "@/i18n/messages/en.json"
import {
  formatConversationTitle,
  conversationTitleTopic,
  parseStructuredConversationTitle,
} from "@/lib/conversation-title"
import { source } from "./contract-source"

describe("date/topic titles without categories", () => {
  it.each(["1117｜通话记录保存时长", "1117 | 设计 | 通话记录保存时长"])(
    "shows only the topic in session details for %s",
    (title) => {
      render(
        <NextIntlClientProvider
          locale="en"
          messages={enMessages}
          timeZone="UTC"
        >
          <SessionDetailsDialog
            open
            onOpenChange={() => {}}
            stats={null}
            summary={{
              id: 2492,
              folder_id: 1,
              title,
              title_locked: false,
              agent_type: "codex",
              status: "completed",
              kind: "regular",
              model: null,
              git_branch: "main",
              external_id: null,
              pinned_at: null,
              message_count: 2,
              child_count: 0,
              created_at: "2026-11-17T08:51:00Z",
              updated_at: "2026-11-17T10:01:00Z",
            }}
          />
        </NextIntlClientProvider>
      )
      expect(screen.getByText("通话记录保存时长")).toBeVisible()
    }
  )

  it.each([
    "1102｜设计｜委托批次与数据权限",
    "1102 | 设计 | 委托批次与数据权限",
    "1102｜委托批次与数据权限",
  ])("normalizes %s for display and editing", (title) => {
    expect(formatConversationTitle(title)).toBe("委托批次与数据权限")
    render(<ConversationTitleLabel title={title} fallback="未命名" />)
    expect(screen.getByText("1102")).toHaveClass("tabular-nums")
    expect(screen.getByText("委托批次与数据权限")).toHaveClass("truncate")
    expect(screen.queryByText(/设计/)).toBeNull()
  })

  it("preserves topic slashes, references and ordinary titles", () => {
    expect(formatConversationTitle("1102｜CI/CD")).toBe("CI/CD")
    expect(formatConversationTitle("1102｜设计｜[权限](file:///tmp/a)")).toBe(
      "权限"
    )
    expect(formatConversationTitle("讨论设计方案")).toBe("讨论设计方案")
    expect(parseStructuredConversationTitle("1102｜CI/CD")).toEqual({
      date: "1102",
      kind: "",
      topic: "CI/CD",
    })
  })

  it.each([
    ["1117｜检查项目部署地址", "检查项目部署地址"],
    ["1117 | 开发 | 检查项目部署地址", "检查项目部署地址"],
    ["1117｜开发｜[权限](file:///tmp/a)", "权限"],
    ["讨论 CI/CD", "讨论 CI/CD"],
    ["2024 年计划", "2024 年计划"],
    [null, ""],
  ])("extracts the editable topic from %s", (title, expected) => {
    expect(conversationTitleTopic(title)).toBe(expected)
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

  it("opens both rename dialogs with only the topic", () => {
    expect(
      source("src/components/conversations/conversation-detail-header.tsx")
    ).toContain("setRenameValue(conversationTitleTopic(title))")
    expect(
      source("src/components/conversations/sidebar-conversation-card.tsx")
    ).toContain("setRenameValue(conversationTitleTopic(conversation.title))")
  })
})
