import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  useWorkbenchRoute,
  WorkbenchRouteProvider,
} from "@/contexts/workbench-route-context"
import { source } from "./contract-source"

describe("MaxCode: no work-task UI entry points", () => {
  it("does not register a task page, title or settings toolbar", () => {
    const registry = source("src/components/workbench/workbench-content.tsx")
    expect(registry).not.toContain("@/components/tasks/")
    expect(registry).not.toMatch(/tasks\s*:/)
  })

  it("removes task navigation and Issue/PR task triggers", () => {
    for (const path of [
      "src/components/layout/sidebar.tsx",
      "src/components/layout/quick-actions-dropdown.tsx",
      "src/components/forge/forge-issue-row.tsx",
      "src/components/forge/forge-issue-detail-sheet.tsx",
    ]) {
      const content = source(path)
      expect(content).not.toContain('setRoute("tasks")')
      expect(content).not.toContain('tSidebar("tasks")')
      expect(content).not.toContain("onClick={onStart}")
      expect(content).not.toContain('t("viewTask")')
    }
    const forge = source("src/components/forge/forge-page.tsx")
    expect(forge).not.toContain("ForgeStartDialog")
    expect(forge).not.toContain("setStartRow")
  })

  it("redirects legacy task navigation to conversations", () => {
    const { result } = renderHook(() => useWorkbenchRoute(), {
      wrapper: WorkbenchRouteProvider,
    })
    act(() => result.current.setRoute("forge"))
    expect(result.current.routeId).toBe("forge")
    act(() => result.current.setRoute("tasks"))
    expect(result.current.routeId).toBe("conversations")
    expect(result.current.isConversations).toBe(true)
  })

  it("keeps the message action as a normal unsent new chat", () => {
    const hook = source("src/components/message/use-new-chat-from-message.ts")
    expect(hook).toContain('delivery: "draft"')
    expect(hook).toContain('setRoute("conversations")')
    expect(hook).not.toContain("requestCreateTaskFromText")
  })
})
