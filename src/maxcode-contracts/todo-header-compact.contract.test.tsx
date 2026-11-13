import { cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, expect, it, vi } from "vitest"
import { SidebarTodoGroupHeader } from "@/components/conversations/sidebar-todo-group-header"
import messages from "@/i18n/messages/en.json"

afterEach(cleanup)

it.each([
  ["新增微信号", "2026-10-19T12:00:00", "10/19"],
  ["1019｜探索｜新增微信号", undefined, "10/19"],
  ["新增微信号", undefined, null],
])("shows compact readable metadata for %s (%s)", (title, createdAt, date) => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SidebarTodoGroupHeader
        id="task"
        title={title}
        createdAt={createdAt}
        expanded={false}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />
    </NextIntlClientProvider>
  )
  expect(screen.getByText("新增微信号")).toBeVisible()
  const meta = container.querySelector("[data-todo-meta]")!
  expect(meta.querySelector("svg.lucide-list-todo")).toHaveClass("size-3")
  expect(container.querySelectorAll("svg.lucide-list-todo")).toHaveLength(1)
  const toggle = screen.getByText("新增微信号").closest("button")!
  expect(toggle).toHaveClass("pr-4")
  const actions = screen.getByRole("button", {
    name: "More actions",
  }).parentElement!
  expect(actions).toHaveClass(
    "absolute",
    "right-9",
    "top-1/2",
    "-translate-y-1/2"
  )
  expect(toggle.parentElement).toHaveClass("relative")
  expect(screen.getByRole("button", { name: "More actions" })).toHaveClass(
    "group-has-[:focus-visible]/todo-header:opacity-100"
  )
  expect(
    screen.getByRole("button", { name: "More actions" }).className
  ).not.toContain("group-focus-within/todo-header:opacity-100")
  expect(meta.textContent).toBe(date ? `${date}·To do` : "To do")
})
