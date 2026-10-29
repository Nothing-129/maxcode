import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import en from "@/i18n/messages/en.json"
import zh from "@/i18n/messages/zh-CN.json"
import { AutomationTodoPicker } from "@/components/automations/automation-todo-picker"
import {
  todoCall,
  todoSearch,
  todoOriginCall,
  type TodoOrigin,
  type TodoSearchResult,
} from "@/lib/todos"
import { source } from "./contract-source"

vi.mock("@/lib/todos", () => ({
  todoCall: vi.fn(),
  todoSearch: vi.fn(),
  todoOriginCall: vi.fn(),
}))

function result(scope: string, title: string): TodoSearchResult {
  return {
    scope_id: scope,
    scope_key: scope,
    todos: [{ id: "todo-1", title, status: "claimed", assignee_id: null }],
    members: [],
    self_id: "me",
    pagination: { page: 1, page_size: 20, total: 1, search: "" },
  }
}
function Picker() {
  const [value, setValue] = useState<TodoOrigin[]>([])
  return (
    <>
      <AutomationTodoPicker value={value} onChange={setValue} />
      <output data-testid="origins">{JSON.stringify(value)}</output>
    </>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(todoCall).mockResolvedValue({
    teams: [{ id: "team-1", name: "Team one", url: null, is_local: true }],
  } as never)
  vi.mocked(todoOriginCall).mockResolvedValue({ todo: null } as never)
})

describe("automation todo mounting contract", () => {
  it("selects from explicit personal/team scopes and preserves both attachments without changing the active todo scope", async () => {
    vi.mocked(todoSearch).mockImplementation(async (request) =>
      result(
        request.scope_id,
        request.scope_id === "personal" ? "Personal review" : "Team review"
      )
    )
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Picker />
      </NextIntlClientProvider>
    )
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Personal review" })
    )
    fireEvent.change(screen.getByLabelText("Todo scope"), {
      target: { value: "team-1" },
    })
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Team review" })
    )
    expect(JSON.parse(screen.getByTestId("origins").textContent!)).toEqual([
      { scope_id: "personal", todo_id: "todo-1" },
      { scope_id: "team-1", todo_id: "todo-1" },
    ])
    expect(
      vi
        .mocked(todoCall)
        .mock.calls.every(([request]) => request.action === "state")
    ).toBe(true)
    fireEvent.click(
      screen.getAllByRole("button", { name: en.Todos.unlinkTodo })[0]
    )
    expect(JSON.parse(screen.getByTestId("origins").textContent!)).toEqual([
      { scope_id: "team-1", todo_id: "todo-1" },
    ])
  })

  it("does not show a late response from a previous scope", async () => {
    let resolvePersonal!: (value: TodoSearchResult) => void
    vi.mocked(todoSearch).mockImplementation((request) =>
      request.scope_id === "personal"
        ? new Promise((resolve) => {
            resolvePersonal = resolve
          })
        : Promise.resolve(result("team-1", "Team review"))
    )
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Picker />
      </NextIntlClientProvider>
    )
    await waitFor(() => expect(todoSearch).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText("Todo scope"), {
      target: { value: "team-1" },
    })
    await screen.findByRole("checkbox", { name: "Team review" })
    resolvePersonal(result("personal", "Stale personal review"))
    await waitFor(() =>
      expect(
        screen.queryByText("Stale personal review")
      ).not.toBeInTheDocument()
    )
  })

  it("keeps the automation name and runtime provenance wiring", () => {
    expect(zh.Folder.sidebar.automations).toBe("自动化")
    expect(JSON.stringify(zh)).not.toContain("自动任务")
    const editor = source("src/components/automations/automation-editor.tsx")
    expect(editor).toContain("todo_origins: enqueue ? [] : todoOrigins")
    const engine = source("src-tauri/src/automation/engine.rs")
    expect(engine).toContain("attached todo no longer exists")
    expect(engine).toContain("conversation_groups::link_origins(")
    expect(engine).toContain('"todo-conversation-links://changed"')
  })
})
