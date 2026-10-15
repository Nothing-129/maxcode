import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { TodosPage } from "@/components/todos/todos-page"
import { TodosViewProvider } from "@/contexts/todos-view-context"
import enMessages from "@/i18n/messages/en.json"
import { todoCall, type TodoState } from "@/lib/todos"
import { source } from "./contract-source"

vi.mock("@/lib/todos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
}))
vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))

describe("todo blue theme", () => {
  it("moves the visible selected state between personal and team scopes", async () => {
    localStorage.clear()
    let state: TodoState = {
      mode: "personal",
      active_team_id: null,
      teams: [],
      self_id: "me",
      members: [],
      todos: [],
      team_code: null,
      public_url: null,
    }
    vi.mocked(todoCall).mockImplementation(async (request) => {
      if (request.action === "set_mode") {
        state = { ...state, mode: request.mode }
      }
      return state
    })
    const user = userEvent.setup()
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <TodosViewProvider>
          <TodosPage />
        </TodosViewProvider>
      </NextIntlClientProvider>
    )
    const personal = await screen.findByRole("button", {
      name: enMessages.Todos.personalMode,
    })
    expect(personal).toHaveAttribute("aria-pressed", "true")
    expect(personal).toHaveAttribute("data-variant", "default")
    expect(personal.closest(".todo-theme")).not.toBeNull()

    await user.click(
      screen.getByRole("button", { name: enMessages.Todos.teamMode })
    )
    await waitFor(() => {
      const team = screen.getByRole("button", {
        name: enMessages.Todos.teamMode,
      })
      expect(team).toHaveAttribute("aria-pressed", "true")
      expect(team).toHaveAttribute("data-variant", "default")
      expect(
        screen.getByRole("button", { name: enMessages.Todos.personalMode })
      ).toHaveAttribute("aria-pressed", "false")
    })
    await user.click(
      screen.getByRole("button", { name: enMessages.Todos.personalMode })
    )
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: enMessages.Todos.personalMode })
      ).toHaveAttribute("aria-pressed", "true")
      expect(
        screen.getByRole("button", { name: enMessages.Todos.teamMode })
      ).toHaveAttribute("data-variant", "ghost")
    })
  })

  it("keeps send blue on todo surfaces including portals", () => {
    const css = source("src/app/globals.css")
    const theme = css.match(/\.todo-theme \{([^}]+)\}/)?.[1]
    expect(theme).toContain("--primary: #216ae4")
    expect(theme).toContain("--primary-foreground: #ffffff")
    expect(theme).toContain("--ring: #216ae4")
    for (const file of [
      "todos-page",
      "todo-editor-dialog",
      "todo-teams-dialog",
      "todo-source-detail-dialog",
      "todo-conversation-link-dialog",
      "todo-conversation-folder-dialog",
      "todo-card",
      "conversation-todo-source-badges",
    ]) {
      const portals = [
        ...source(`src/components/todos/${file}.tsx`).matchAll(
          /<(?:DialogContent|SelectContent|DropdownMenuContent)\b[^>]*(?:\[&>\*\][^>]*)?>/g
        ),
      ]
      expect(portals.length).toBeGreaterThan(0)
      for (const [portal] of portals)
        expect(portal).toContain('className="todo-theme')
    }
  })
})
