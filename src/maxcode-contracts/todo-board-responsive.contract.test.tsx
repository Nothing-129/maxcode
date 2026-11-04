import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { TodosPage } from "@/components/todos/todos-page"
import { TodosLoadingSkeleton } from "@/components/todos/todos-loading-skeleton"
import { TodosViewProvider } from "@/contexts/todos-view-context"
import enMessages from "@/i18n/messages/en.json"
import { todoCall } from "@/lib/todos"

vi.mock("@/lib/todos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/todos")>()),
  todoCall: vi.fn(),
}))
vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))

describe("todo board responsive layout", () => {
  it("keeps all five columns readable and scrolls inside the workspace", async () => {
    localStorage.clear()
    vi.mocked(todoCall).mockResolvedValue({
      mode: "personal",
      active_team_id: null,
      teams: [],
      self_id: "me",
      members: [],
      todos: [],
      team_code: null,
      public_url: null,
    })
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <TodosViewProvider>
          <TodosPage />
        </TodosViewProvider>
      </NextIntlClientProvider>
    )
    const columns = await screen.findAllByRole("region")
    expect(columns).toHaveLength(5)
    for (const column of columns) {
      expect(column).toHaveClass("min-w-80", "flex-1")
    }
    expect(columns[0].parentElement).toHaveClass("min-w-0", "overflow-x-auto")
    expect(container.firstElementChild).toHaveClass(
      "min-w-0",
      "overflow-hidden"
    )
  })

  it("reserves the same column width during loading", () => {
    const { container } = render(
      <TodosLoadingSkeleton label="Loading" viewMode="board" />
    )
    expect(container.querySelectorAll(".min-w-80")).toHaveLength(5)
    expect(screen.getByRole("status")).toHaveClass("min-w-0", "overflow-hidden")
  })
})
