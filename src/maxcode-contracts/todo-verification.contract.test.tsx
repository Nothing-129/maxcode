import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { TodoCard } from "@/components/todos/todo-card"
import zhCN from "@/i18n/messages/zh-CN.json"
import type { Todo } from "@/lib/todos"

vi.mock("@/components/todos/use-new-chat-from-todo", () => ({
  useNewChatFromTodo: () => vi.fn(),
}))

import { groupTodos, TODO_COLUMNS } from "@/components/todos/board-columns"

describe("production verification", () => {
  it("keeps pending work in its own column and offers explicit verification", async () => {
    const todo: Todo = {
      id: "pending",
      title: "Release",
      content: "Verify production",
      status: "pending_verification",
      assignee_id: "me",
      creator_id: "me",
      revision: 2,
      source_url: null,
      created_at: "2026-10-26T00:00:00Z",
      updated_at: "2026-10-26T00:00:00Z",
    }
    expect(TODO_COLUMNS).toEqual([
      "unclaimed",
      "claimed",
      "mine",
      "pending_verification",
      "completed",
    ])
    for (const selfId of ["me", "other", null]) {
      const groups = groupTodos([todo], selfId)
      expect(groups.pending_verification).toEqual([todo])
      expect(groups.completed).toEqual([])
    }
    const onAction = vi.fn()
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhCN}>
        <TodoCard
          todo={todo}
          selfId="me"
          disabled={false}
          onOpen={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onAction={onAction}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByText("上线待验证")).toBeVisible()
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "任务已验证" }))
    expect(onAction).toHaveBeenCalledWith("verify")
    expect(screen.queryByRole("button", { name: "已完成" })).toBeNull()
  })
})
