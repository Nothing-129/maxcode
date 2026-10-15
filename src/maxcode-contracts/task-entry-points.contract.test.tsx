import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  useWorkbenchRoute,
  WorkbenchRouteProvider,
} from "@/contexts/workbench-route-context"
import {
  WorkbenchRoutePage,
  WorkbenchRouteStrip,
  WorkbenchRouteChromeActions,
  useHasWorkbenchRouteStrip,
} from "@/components/workbench/workbench-content"
import { OPEN_TODO_TEAMS_EVENT } from "@/components/todos/todos-chrome-actions"
import enMessages from "@/i18n/messages/en.json"
import { source } from "./contract-source"

const state = vi.hoisted(() => ({
  viewMode: "board" as "board" | "list",
  setViewMode: vi.fn(),
}))
vi.mock("@/contexts/todos-view-context", () => ({
  useTodosView: () => ({
    state: { todos: [{ id: "new-todo" }] },
    viewMode: state.viewMode,
    setViewMode: state.setViewMode,
  }),
}))
vi.mock("@/components/todos/todos-page", () => ({
  TodosPage: () => <div>Task board</div>,
  TodosPageTitle: () => <h1>Tasks</h1>,
}))
vi.mock("@/components/automations/automations-page", () => ({
  AutomationsPage: () => null,
  AutomationsPageTitle: () => null,
}))
vi.mock("@/components/canvas/canvas-page", () => ({
  CanvasPage: () => null,
  CanvasPageTitle: () => null,
}))
vi.mock("@/components/forge/forge-page", () => ({
  ForgePage: () => null,
  ForgePageTitle: () => null,
}))
vi.mock("@/components/forge/forge-chrome-actions", () => ({
  ForgeChromeActions: () => null,
}))
vi.mock("@/components/token-usage/token-usage-page", () => ({
  TokenUsagePage: () => null,
  TokenUsagePageTitle: () => null,
}))

function Workspace() {
  const { setRoute, openConversations, isConversations } = useWorkbenchRoute()
  const hasStrip = useHasWorkbenchRouteStrip()
  return (
    <>
      <button onClick={() => setRoute("tasks")}>Open tasks</button>
      <button onClick={openConversations}>Back to conversations</button>
      <div data-testid="workspace-mode">
        {isConversations ? "conversations" : "page"}
      </div>
      {hasStrip && <WorkbenchRouteStrip />}
      <WorkbenchRoutePage />
      <WorkbenchRouteChromeActions
        buttonClassName="h-8"
        iconClassName="size-4"
      />
    </>
  )
}

function mount() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WorkbenchRouteProvider>
        <Workspace />
      </WorkbenchRouteProvider>
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole("button", { name: "Open tasks" }))
}

describe("MaxCode: independent todo entry points", () => {
  beforeEach(() => {
    state.viewMode = "board"
    state.setViewMode.mockClear()
  })

  it("opens the board with its title and returns to conversations", () => {
    mount()
    expect(screen.getByText("Task board")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeVisible()
    expect(screen.getByTestId("workspace-mode")).toHaveTextContent("page")
    fireEvent.click(
      screen.getByRole("button", { name: "Back to conversations" })
    )
    expect(screen.queryByText("Task board")).toBeNull()
    expect(screen.queryByRole("heading", { name: "Tasks" })).toBeNull()
    expect(screen.getByTestId("workspace-mode")).toHaveTextContent(
      "conversations"
    )
  })

  it.each(["board", "list"] as const)(
    "exposes the view switch and team controls in %s mode",
    (mode) => {
      state.viewMode = mode
      mount()
      const label =
        enMessages.Todos[
          mode === "board" ? "viewSwitchToList" : "viewSwitchToBoard"
        ]
      fireEvent.click(screen.getByRole("button", { name: label }))
      expect(state.setViewMode).toHaveBeenCalledWith(
        mode === "board" ? "list" : "board"
      )
      const openSettings = vi.fn()
      window.addEventListener(OPEN_TODO_TEAMS_EVENT, openSettings)
      try {
        fireEvent.click(
          screen.getByRole("button", { name: enMessages.Todos.teams })
        )
        expect(openSettings).toHaveBeenCalledOnce()
      } finally {
        window.removeEventListener(OPEN_TODO_TEAMS_EVENT, openSettings)
      }
    }
  )

  it("keeps the message action as a normal unsent new chat", () => {
    const hook = source("src/components/message/use-new-chat-from-message.ts")
    expect(hook).toContain('delivery: "draft"')
    expect(hook).toContain('setRoute("conversations")')
    expect(hook).not.toContain("requestCreateTaskFromText")
  })
})
