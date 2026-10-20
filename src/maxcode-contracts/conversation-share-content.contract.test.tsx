import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { ConversationShareOptionsEditor } from "@/components/conversations/conversation-share-options"
import { SharedConversationView } from "@/components/conversations/shared-conversation-view"
import {
  groupConversationShareRounds,
  mergeShareTextBlocks,
  partitionShareReplies,
  splitShareUserText,
} from "@/lib/conversation-share-content"
import type {
  ContentBlock,
  MessageTurn,
  SharedConversationSnapshot,
} from "@/lib/types"

const NOW = "2026-10-13T10:00:00Z"
const turn = (
  role: MessageTurn["role"],
  blocks: ContentBlock[],
  id = "message"
): MessageTurn => ({ id, role, timestamp: NOW, blocks })
const text = (value: string): ContentBlock => ({ type: "text", text: value })
const snapshot = (
  turns: MessageTurn[],
  options?: SharedConversationSnapshot["share_options"]
): SharedConversationSnapshot => ({
  version: options ? 2 : 1,
  title: "Shared conversation",
  agent_type: "codex",
  model: null,
  created_at: NOW,
  updated_at: NOW,
  shared_at: NOW,
  message_count: turns.length,
  turns,
  share_options: options,
})
function show(value: SharedConversationSnapshot) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value), { status: 200 }))
  )
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SharedConversationView />
    </NextIntlClientProvider>
  )
}
const mixed = () => [
  turn("system", [text("PRIVATE SYSTEM")]),
  turn("user", [text("First question")], "u1"),
  turn("assistant", [text("Progress update")], "a1"),
  turn(
    "assistant",
    [
      {
        type: "tool_use",
        tool_use_id: "internal",
        tool_name: "Shell",
        input_preview: "PRIVATE COMMAND",
      },
    ],
    "tool"
  ),
  turn(
    "assistant",
    [{ type: "thinking", text: "PRIVATE THINKING" }],
    "thinking"
  ),
  turn("assistant", [text("Final answer")], "a2"),
  turn("user", [text("Second question")], "u2"),
  turn("assistant", [text("Second answer")], "a3"),
]

describe("MaxCode contract: readable and selective conversation sharing", () => {
  beforeEach(() =>
    window.history.replaceState(null, "", `/share#${"a".repeat(32)}`)
  )
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.replaceState(null, "", "/")
  })

  it("offers round selection without execution sharing controls", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ConversationShareOptionsEditor
          rounds={[{ number: 1, preview: "Question" }]}
          options={{}}
          onChange={vi.fn()}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole("combobox")).toBeEnabled()
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByText("Include tool logs")).toBeNull()
    expect(screen.queryByText("Include thinking")).toBeNull()
  })

  it("groups every assistant fragment into the owning user round without mutating the transcript", () => {
    const input = mixed()
    const rounds = groupConversationShareRounds(input)
    expect(rounds).toHaveLength(2)
    expect(rounds[0].replies.map((reply) => reply.id)).toEqual([
      "a1",
      "tool",
      "thinking",
      "a2",
    ])
    expect(rounds[1].user?.id).toBe("u2")
    const blocks = [
      text("First"),
      text("Second"),
      { type: "image", data: "base64", mime_type: "image/png" } as ContentBlock,
      text("Last"),
    ]
    expect(mergeShareTextBlocks(blocks)).toEqual([
      text("First\n\nSecond"),
      blocks[2],
      text("Last"),
    ])
    expect(blocks[0]).toEqual(text("First"))
  })

  it("defaults legacy links to readable text and renders each role once per round", async () => {
    const view = show(snapshot(mixed()))
    await screen.findByText("Final answer", { exact: false })
    expect(view.container.querySelectorAll("article")).toHaveLength(2)
    expect(screen.getAllByText("Assistant", { exact: true })).toHaveLength(2)
    expect(screen.queryByText("Shell")).toBeNull()
    expect(screen.queryByText("PRIVATE THINKING")).toBeNull()
    expect(screen.queryByText("PRIVATE SYSTEM")).toBeNull()
    expect(screen.queryByText(/Execution details/)).toBeNull()
  })

  it("keeps the answer prominent and shows process text only after expansion", async () => {
    const user = userEvent.setup()
    show(snapshot(mixed()))
    await screen.findByText("Final answer", { exact: true })
    expect(screen.queryByText("Progress update")).toBeNull()
    expect(screen.getByText("Second answer")).toBeVisible()
    const summary = screen.getByText("Process updates · 1 items")
    expect(summary.closest("details")).not.toHaveAttribute("open")
    await user.click(summary)
    expect(await screen.findByText("Progress update")).toBeVisible()
    await user.click(summary)
    await waitFor(() =>
      expect(screen.queryByText("Progress update")).toBeNull()
    )
    expect(screen.getByText("Final answer")).toBeVisible()
  })

  it("folds work preambles even when sharing before a final answer exists", async () => {
    const user = userEvent.setup()
    const progress = "我先把已确认的方案保存到现有目录，再核对配置。"
    show(
      snapshot([
        turn("user", [text("请保存方案")]),
        turn("assistant", [text(progress)]),
      ])
    )
    await screen.findByText("请保存方案")
    expect(screen.queryByText(progress)).toBeNull()
    await user.click(screen.getByText("Process updates · 1 items"))
    expect(await screen.findByText(progress)).toBeVisible()
  })

  it("folds complete harness instructions without hiding the following question", async () => {
    const user = userEvent.setup()
    const instructions =
      "# AGENTS.md instructions for /project\n\n<INSTRUCTIONS>\nRead the local rules.\n</INSTRUCTIONS>"
    const environment =
      "<environment_context>\nWorking directory: /project\n</environment_context>"
    const original = `${instructions}\n${environment}\n\nWhat should we change?`
    expect(splitShareUserText(original)).toEqual({
      text: "What should we change?",
      metadata: `${instructions}\n\n${environment}`,
    })
    expect(
      splitShareUserText("Please explain # AGENTS.md instructions").metadata
    ).toBeNull()
    expect(
      splitShareUserText("# AGENTS.md instructions\n<INSTRUCTIONS>unterminated")
        .metadata
    ).toBeNull()
    const view = show(
      snapshot([
        turn("user", [text(instructions)]),
        turn("user", [text("What should we change?")]),
        turn("assistant", [text("The final recommendation.")]),
      ])
    )
    await screen.findByText("The final recommendation.")
    expect(screen.getAllByText("You", { exact: true })).toHaveLength(1)
    expect(screen.getByText(/Read the local rules/)).not.toBeVisible()
    await user.click(screen.getByText("Session information"))
    expect(screen.getByText(/Read the local rules/)).toBeVisible()
    expect(view.container.textContent).toContain("What should we change?")
  })

  it("preserves intermediate reply text and images without mutating source blocks", () => {
    const image: ContentBlock = {
      type: "image",
      data: "base64",
      mime_type: "image/png",
    }
    const input = [
      turn("assistant", [text("Earlier explanation"), image]),
      turn("assistant", [text("The final answer")]),
    ]
    const original = structuredClone(input)
    expect(partitionShareReplies(input)).toEqual({
      answer: [image, text("The final answer")],
      process: [text("Earlier explanation")],
    })
    expect(input).toEqual(original)
    expect(
      partitionShareReplies([
        turn("assistant", [text("A single complete answer")]),
      ]).answer
    ).toEqual([text("A single complete answer")])
  })

  it("excludes execution even when an existing snapshot opted in", async () => {
    show(snapshot(mixed(), { includeTools: true, includeThinking: true }))
    await screen.findByText("Final answer", { exact: false })
    expect(screen.queryByText(/Execution details/)).toBeNull()
    expect(screen.queryByText("Shell")).toBeNull()
    expect(screen.queryByText("PRIVATE COMMAND")).toBeNull()
    expect(screen.queryByText("PRIVATE THINKING")).toBeNull()
  })

  it("keeps meaningful images while omitting legacy tool output", async () => {
    const view = show(
      snapshot([
        turn("assistant", [
          {
            type: "tool_result",
            tool_use_id: null,
            is_error: false,
            output_preview: "PRIVATE OUTPUT",
            images: [
              {
                data: "aGVsbG8=",
                mime_type: "image/png",
                uri: "file:///private/image.png",
              },
            ],
          },
        ]),
      ])
    )
    await screen.findByRole("heading", { name: "Shared conversation" })
    expect(view.container.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,aGVsbG8="
    )
    expect(view.container.textContent).not.toContain("PRIVATE OUTPUT")
  })

  it("loads ten rounds at a time and retains previous answers when more are shown", async () => {
    const user = userEvent.setup()
    const turns = Array.from({ length: 12 }, (_, index) => [
      turn("user", [text(`Question ${index + 1}`)], `u${index}`),
      turn("assistant", [text(`Answer ${index + 1}`)], `a${index}`),
    ]).flat()
    const view = show(snapshot(turns))
    await screen.findByText("Question 1")
    expect(view.container.querySelectorAll("article")).toHaveLength(10)
    expect(screen.queryByText("Question 11")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Show next 2 rounds" }))
    expect(screen.getByText("Answer 12")).toBeInTheDocument()
    expect(screen.getByText("Answer 1")).toBeInTheDocument()
    expect(view.container.querySelectorAll("article")).toHaveLength(12)
  })

  it("folds copied session metadata below the actual question and preserves arbitrary user text", async () => {
    const original =
      "会话 ID\n1155\n\n模型\n6.1 Sol\nGit 分支\nmain\n扩展 ID\n01a0fa64-69ae-70b3-985a-1e9f5683b03c\n\n\n\n总结一下这个会话干的事情"
    expect(splitShareUserText(original).text).toBe("总结一下这个会话干的事情")
    expect(
      splitShareUserText("Git 分支\nmain\n请解释这个分支").metadata
    ).toBeNull()
    show(snapshot([turn("user", [text(original)])]))
    await screen.findByText("总结一下这个会话干的事情")
    expect(screen.getByText("Session information")).toBeVisible()
    await waitFor(() => expect(screen.getByText(/01a0fa64/)).not.toBeVisible())
  })
})
