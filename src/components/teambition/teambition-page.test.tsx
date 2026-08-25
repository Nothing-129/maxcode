import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { TeambitionBoard, TeambitionTask } from "@/lib/types"

import { TeambitionPage } from "./teambition-page"

const mocks = vi.hoisted(() => ({
  board: vi.fn(),
  updateStatus: vi.fn(),
  emitAppendText: vi.fn(),
  openConversations: vi.fn(),
  openSettings: vi.fn(),
  openNewConversationTab: vi.fn(),
  openUrl: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  openSettingsWindow: mocks.openSettings,
  teambitionBoard: mocks.board,
  teambitionUpdateTaskStatus: mocks.updateStatus,
}))

vi.mock("@/lib/session-attachment-events", () => ({
  emitAppendTextToSession: mocks.emitAppendText,
}))

vi.mock("@/lib/platform", () => ({ openUrl: mocks.openUrl }))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({
    openNewConversationTab: mocks.openNewConversationTab,
  }),
  useTabStore: {
    getState: () => ({ activeTabId: "draft-1" }),
  },
}))

vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({
    routeId: "teambition",
    openConversations: mocks.openConversations,
  }),
}))

vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: (
    selector: (state: { folders: unknown[] }) => unknown
  ) =>
    selector({
      folders: [
        {
          id: 7,
          name: "api",
          alias: "Core API",
          path: "/repo/api",
          parent_id: null,
          kind: "regular",
        },
        {
          id: 8,
          name: "worktree",
          alias: null,
          path: "/repo/worktree",
          parent_id: 7,
          kind: "regular",
        },
      ],
    }),
}))

const task: TeambitionTask = {
  taskId: "task-1",
  projectId: "67244dbc1b2dbce76a282336",
  uniqueId: 2711,
  content: "Implement MCP task board",
  tfsId: "status-todo",
  sfcId: "scenario-1",
  executorId: null,
  dueDate: null,
  accomplishTime: null,
  isDone: false,
  priority: 0,
  created: "2026-08-20T00:00:00.000Z",
  updated: "2026-08-25T00:00:00.000Z",
}

const board: TeambitionBoard = {
  projectId: "67244dbc1b2dbce76a282336",
  tasks: [task],
  statuses: [
    {
      id: "status-todo",
      name: "To do",
      kind: "start",
      pos: 1,
      taskflowId: "flow-1",
      isDeleted: false,
    },
    {
      id: "status-doing",
      name: "In progress",
      kind: "normal",
      pos: 2,
      taskflowId: "flow-1",
      isDeleted: false,
    },
    {
      id: "other-flow-status",
      name: "Other workflow",
      kind: "start",
      pos: 1,
      taskflowId: "flow-2",
      isDeleted: false,
    },
  ],
  taskflows: [
    { id: "flow-1", name: "Default workflow", isDeleted: false },
    { id: "flow-2", name: "Other", isDeleted: false },
  ],
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TeambitionPage />
    </NextIntlClientProvider>
  )
}

describe("TeambitionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.board.mockResolvedValue(board)
    mocks.openSettings.mockResolvedValue(undefined)
    mocks.updateStatus.mockImplementation(
      async (_taskId: string, statusId: string) => ({
        ...task,
        tfsId: statusId,
      })
    )
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback): number => {
        callback(0)
        return 1
      }
    )
  })

  it("groups participating tasks into task-status columns", async () => {
    renderPage()

    expect(await screen.findByText("Implement MCP task board")).toBeVisible()
    expect(screen.getByText("To do")).toBeVisible()
    expect(screen.getByText("In progress")).toBeVisible()
    expect(screen.queryByText("Other workflow")).toBeNull()
  })

  it("manually fetches the latest tasks from the board button", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Implement MCP task board")

    await user.click(screen.getByRole("button", { name: "Get latest" }))

    await waitFor(() => expect(mocks.board).toHaveBeenCalledTimes(2))
  })

  it("fetches again after leaving and re-entering the page", async () => {
    const firstVisit = renderPage()
    await screen.findByText("Implement MCP task board")
    expect(mocks.board).toHaveBeenCalledOnce()

    firstVisit.unmount()
    renderPage()

    await waitFor(() => expect(mocks.board).toHaveBeenCalledTimes(2))
  })

  it("shows MCP preflight guidance and opens MCP settings", async () => {
    const user = userEvent.setup()
    mocks.board.mockRejectedValueOnce(
      new Error("Teambition MCP preflight failed: missing required tools")
    )
    renderPage()

    expect(
      await screen.findByText("Teambition MCP preflight failed")
    ).toBeVisible()
    expect(
      screen.getByText(
        "Teambition MCP preflight failed: missing required tools"
      )
    ).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Open MCP settings" }))
    expect(mocks.openSettings).toHaveBeenCalledWith("mcp")
  })

  it("updates the task status and moves a dropped card to the target column", async () => {
    const { container } = renderPage()
    const taskButton = await screen.findByText("Implement MCP task board")
    const taskCard = taskButton.closest("article")
    const targetColumn = container.querySelector(
      '[data-teambition-status-id="status-doing"]'
    )
    expect(taskCard).not.toBeNull()
    expect(targetColumn).not.toBeNull()

    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      getData: vi.fn(),
      setData: vi.fn(),
    }
    fireEvent.dragStart(taskCard as HTMLElement, { dataTransfer })
    fireEvent.dragOver(targetColumn as HTMLElement, { dataTransfer })
    fireEvent.drop(targetColumn as HTMLElement, { dataTransfer })

    await waitFor(() =>
      expect(mocks.updateStatus).toHaveBeenCalledWith("task-1", "status-doing")
    )
    expect(
      within(targetColumn as HTMLElement).getByText("Implement MCP task board")
    ).toBeVisible()
  })

  it("opens a folder draft and inserts only the short task ID", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Implement MCP task board")

    await user.click(
      screen.getByRole("button", { name: "Add task ID to a folder input" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Core API" }))

    expect(mocks.openNewConversationTab).toHaveBeenCalledWith(7, "/repo/api")
    expect(mocks.openConversations).toHaveBeenCalledOnce()
    expect(mocks.emitAppendText).toHaveBeenCalledWith({
      tabId: "draft-1",
      text: "KKNL-2711",
    })
  })
})
