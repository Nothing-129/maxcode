import { describe, expect, it } from "vitest"
import zhCN from "@/i18n/messages/zh-CN.json"
import { source } from "./contract-source"

describe("sidebar navigation scope", () => {
  it("labels the Simplified Chinese navigation actions 新对话 and 自动任务", () => {
    expect(zhCN.Folder.sidebar.newChat).toBe("新对话")
    expect(zhCN.Folder.sidebar.automations).toBe("自动任务")
    expect(zhCN.Folder.sidebar.tasks).toBe("待办")
  })

  it("uses 14px labels at default zoom for navigation actions", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    const navButton = sidebar.slice(
      sidebar.indexOf("function SidebarNavButton("),
      sidebar.indexOf("export function Sidebar()")
    )
    expect(navButton).toContain(
      "text-[0.875rem] leading-5 text-sidebar-foreground"
    )
  })

  it("keeps the three actions in one compact button row without a task count", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toContain(
      'data-sidebar-actions className="flex items-center gap-1"'
    )
    expect(sidebar).toContain("h-8 min-w-0 flex-1")
    expect(sidebar).toContain(
      "justify-center gap-1.5 rounded-lg bg-sidebar-accent/35"
    )
    expect(sidebar).not.toContain("attentionCount")
    const row = sidebar.slice(sidebar.indexOf("<div data-sidebar-actions"))
    expect(row.indexOf('icon="compose"')).toBeLessThan(
      row.indexOf('icon="clock"')
    )
    expect(row.indexOf('icon="clock"')).toBeLessThan(
      row.indexOf('icon="tasks"')
    )
  })

  it("routes every new conversation entry through touch sidebar navigation", () => {
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    for (const handler of [
      "handleNewChat",
      "handleNewConversation",
      "handleNewConversationForFolder",
    ]) {
      const start = list.indexOf(`const ${handler} = useCallback(`)
      expect(start).toBeGreaterThan(-1)
      const body = list.slice(start, list.indexOf("\n  const ", start + 1))
      expect(body).toContain("onNavigate?.()")
      expect(body).toContain("openConversations()")
    }
    expect(list).toMatch(
      /row.section === "chats" \|\| row.section === "recent"\s*\? handleNewChat/
    )
  })

  it("restores tasks while keeping repository dashboard out of the sidebar", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).not.toContain('label={t("forge")}')
    expect(sidebar).not.toContain('setRoute("forge")')
    expect(sidebar).toContain('label={t("tasks")}')
    expect(sidebar).toContain('setRoute("tasks")')
    expect(sidebar).toContain('label={t("newChat")}')
    expect(sidebar).toContain('label={t("automations")}')
    expect(sidebar).toContain("<SidebarConversationList")
  })
})
