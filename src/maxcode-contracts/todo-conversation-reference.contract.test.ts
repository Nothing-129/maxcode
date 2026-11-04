import { beforeEach, describe, expect, it, vi } from "vitest"
import { todoConversationText } from "@/components/todos/board-columns"
import { todoConversationReference } from "@/lib/todo-conversation-reference"
import { todoCall, todoOriginCall, type Todo } from "@/lib/todos"

const call = vi.hoisted(() => vi.fn())
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ call }) }))

const original =
  "https://maxcodezzy.yuanjia101.com/share#7d78ea8e896942efa44281d8a6f6a85c"
const canonical =
  "https://maxcodezcy.yuanjia101.com/share#0c8a29fef1cd40ab9eb4d27746c02849"
const title = "1023｜优化｜消息消费机制审计"
const content = `${title}\n\n详情见对话：${original}`
const normalized = content
const todo: Todo = {
  id: "audit",
  title,
  content,
  source_url: canonical,
  status: "unclaimed",
  assignee_id: null,
  creator_id: "alice",
  revision: 1,
  created_at: "2026-10-23T00:00:00Z",
  updated_at: "2026-10-23T00:00:00Z",
}

beforeEach(() => call.mockReset())

describe("MaxCode: creator-owned todo conversation reference", () => {
  it("preserves the original creator link in legacy tasks", () => {
    expect(todoConversationText(todo)).toBe(normalized)
    expect(todoConversationText({ ...todo, content: normalized })).toBe(
      normalized
    )
    expect(todo.content).toBe(content)
  })

  it("preserves generated references in every supported language", () => {
    const locales = import.meta.glob<{
      Todos: { conversationLinkContent: string }
    }>("../i18n/messages/*.json", { eager: true, import: "default" })
    expect(Object.keys(locales)).toHaveLength(10)
    for (const messages of Object.values(locales)) {
      const template = messages.Todos.conversationLinkContent
      expect(
        todoConversationText({
          ...todo,
          content: template.replace("{url}", original),
        })
      ).toBe(template.replace("{url}", original))
    }
  })

  it("preserves unrelated URLs, prose and code examples", () => {
    const body = [
      `Compare [another conversation](${original}).`,
      `See conversation: ${original} for context`,
      "```text",
      `详情见对话：${original}`,
      "```",
      "~~~text",
      `详情见对话：${original}`,
      "~~~",
    ].join("\n")
    expect(todoConversationText({ ...todo, content: body })).toBe(
      `${body}\n\n${canonical}`
    )
    expect(todoConversationReference(content)).toBe(original)
    expect(todoConversationText({ ...todo, source_url: null })).toBe(content)
    expect(todoConversationReference(body)).toBeNull()
    expect(todoConversationText({ ...todo, content: canonical })).toBe(
      canonical
    )
  })

  it.each(["personal", "team"])(
    "uses the same reference in the %s board and source details",
    async (mode) => {
      call.mockResolvedValueOnce({ mode, todos: [todo] })
      const board = await todoCall({ action: "state" })
      expect(board.todos[0].content).toBe(normalized)
      call.mockResolvedValueOnce({ mode, todo })
      const detail = await todoOriginCall({
        action: "get",
        origin: { scope_id: mode, todo_id: todo.id },
      })
      expect(detail.todo?.content).toBe(normalized)
      expect(detail.todo?.source_url).toBe(original)
    }
  )

  it("prefers the original creator reference over a legacy personal source", async () => {
    const relative = "/share#0c8a29fef1cd40ab9eb4d27746c02849"
    call.mockResolvedValueOnce({
      mode: "personal",
      todos: [{ ...todo, source_url: relative }],
    })
    const result = await todoCall({ action: "state" })
    expect(result.todos[0].source_url).toBe(original)
    expect(todoConversationText(result.todos[0])).toBe(content)
    call.mockResolvedValueOnce({
      mode: "personal",
      todos: [{ ...todo, content: "Plain task", source_url: relative }],
    })
    const plain = await todoCall({ action: "state" })
    expect(plain.todos[0].source_url).toBe(
      new URL(relative, window.location.origin).href
    )
  })
})
