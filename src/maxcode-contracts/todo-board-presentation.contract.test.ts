import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("quiet todo board presentation", () => {
  it("uses the specified column and card surfaces without changing card actions", () => {
    const card = source("src/components/todos/todo-card.tsx")
    const page = source("src/components/todos/todos-page.tsx")
    expect(card).toContain(
      "rounded-[0.875rem] border border-[#ececec] bg-white p-3 shadow-[0_1px_3px_rgb(0_0_0/0.025)]"
    )
    expect(page).toContain("bg-[#fafafa] dark:bg-muted/35")
    expect(page).toContain("flex flex-col gap-3 px-3 pb-3")
    expect(card).toContain("line-clamp-2 whitespace-pre-wrap")
  })
  it("keeps team context in both title strips and queries in the wrapping toolbar", () => {
    const page = source("src/components/todos/todos-page.tsx")
    for (const group of ["workspace", "filters"]) {
      expect(page).toContain(`data-todo-toolbar-group="${group}"`)
    }
    const toolbar = page.slice(page.indexOf("data-todo-toolbar\n"))
    expect(toolbar).not.toContain('data-todo-toolbar-group="workspace"')
    expect(toolbar).toContain("<TodoSearchActions canWrite={canWrite} />")
    expect(toolbar).not.toContain('aria-label={t("selectTeam")}')
    expect(page).toMatch(
      /justify-end[^>]*>\s*<TodoModeSwitcher \/>\s*<TodoTeamSwitcher \/>/
    )
    expect(
      source("src/components/todos/todos-chrome-actions.tsx")
    ).not.toContain('t("newTodo")')
    expect(
      source("src/app/workspace/layout.tsx").match(/<TodoScopeControls \/>/g)
    ).toHaveLength(2)
    expect(page).toContain("data-todo-toolbar")
    expect(page).toContain("@container")
    expect(page).not.toContain('<Users className="size-4" />')
  })
  it("places the desktop board actions in the same strip as its breadcrumb", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toMatch(
      /<WorkbenchRouteStrip \/>[\s\S]{0,300}routeId === "tasks"[\s\S]{0,160}<RightEdgeChrome \/>/
    )
    expect(layout).toMatch(
      /routeId !== "tasks"[\s\S]{0,100}data-conversation-navigation/
    )
  })
})
