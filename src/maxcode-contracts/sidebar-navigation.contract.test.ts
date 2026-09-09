import { describe, expect, it } from "vitest"
import zhCN from "@/i18n/messages/zh-CN.json"
import { source } from "./contract-source"

describe("sidebar navigation scope", () => {
  it("labels the Simplified Chinese navigation actions 新建对话 and 自动任务", () => {
    expect(zhCN.Folder.sidebar.newChat).toBe("新建对话")
    expect(zhCN.Folder.sidebar.automations).toBe("自动任务")
  })

  it("uses 14px labels at default zoom for both navigation actions", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    const navButton = sidebar.slice(
      sidebar.indexOf("function SidebarNavButton("),
      sidebar.indexOf("export function Sidebar()")
    )
    expect(navButton).toContain(
      "text-[0.875rem] leading-5 text-sidebar-foreground"
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

  it("excludes tasks and repository dashboard regardless of saved visibility", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    for (const route of ["tasks", "forge"]) {
      expect(sidebar).not.toContain(`label={t("${route}")}`)
      expect(sidebar).not.toContain(`setRoute("${route}")`)
    }
    expect(sidebar).toContain('label={t("newChat")}')
    expect(sidebar).toContain('label={t("automations")}')
    expect(sidebar).toContain("<SidebarConversationList")
  })
})
