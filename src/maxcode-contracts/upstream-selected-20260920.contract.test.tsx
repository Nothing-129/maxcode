import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AskQuestionCard } from "@/components/chat/ask-question-card"
import { PermissionDialog } from "@/components/chat/permission-dialog"
import { parsePermissionToolCall } from "@/lib/permission-request"
import { normalizeToolName } from "@/lib/tool-call-normalization"
import type { PendingQuestionState } from "@/lib/types"
import en from "@/i18n/messages/en.json"
import { source } from "./contract-source"

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div>{children}</div>
  ),
}))
afterEach(cleanup)

const question: PendingQuestionState = {
  question_id: "contract",
  created_at: "2026-09-20T00:00:00Z",
  questions: [
    {
      id: "one",
      header: "Strategy",
      question: "How should we proceed?",
      multi_select: false,
      options: [
        { label: "Small patch", description: "Keep existing behavior" },
      ],
    },
  ],
}

function card(onAnswer = vi.fn(), pending = question, readOnly = false) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <AskQuestionCard
        question={pending}
        onAnswer={onAnswer}
        readOnly={readOnly}
      />
    </NextIntlClientProvider>
  )
}

describe("selected upstream: blocking question stays explicit", () => {
  it("preserves selections and the MaxCode shell without submitting on collapse", () => {
    const answer = vi.fn()
    render(card(answer))
    expect(
      screen.getByRole("group", { name: en.Folder.chat.askQuestion.title })
        .className
    ).toContain("rounded-[20px]")
    fireEvent.click(screen.getByRole("radio", { name: /Small patch/ }))
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }))
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false"
    )
    expect(
      screen.queryByRole("button", { name: "Submit" })
    ).not.toBeInTheDocument()
    expect(answer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Expand" }))
    expect(screen.getByRole("radio", { name: /Small patch/ })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    expect(answer).toHaveBeenCalledWith("contract", {
      answers: [{ questionId: "one", labels: ["Small patch"] }],
      declined: false,
    })
  })

  it("opens a replacement question and never adds a collapse control to answered records", () => {
    const answer = vi.fn()
    const view = render(card(answer))
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }))
    view.rerender(card(answer, { ...question, question_id: "next" }))
    expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }))
    view.rerender(card(answer, { ...question, question_id: "next" }, true))
    expect(screen.getByText("How should we proceed?")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Collapse" })
    ).not.toBeInTheDocument()
  })

  it("reopens the form if an in-flight submission fails after collapse", async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail
    })
    const answer = vi.fn(() => pending)
    render(card(answer))
    fireEvent.click(screen.getByRole("radio", { name: /Small patch/ }))
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }))
    await act(async () => {
      reject(new Error("offline"))
      await pending.catch(() => {})
    })
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.Folder.chat.askQuestion.submitError
    )
    expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled()
    expect(answer).toHaveBeenCalledTimes(1)
  })
})

describe("selected upstream: Claude 0.79 command approvals", () => {
  it.each([
    "[ -f package.json ] && pnpm test",
    "{ npm test; }",
    "[System.Environment]::OSVersion",
    "cat <<'EOF' > fix.patch\n--- a/x\n+++ b/x\nEOF",
  ])("never hides command-valued shell text: %s", (command) => {
    const parsed = parsePermissionToolCall({
      title: command,
      kind: "execute",
      rawInput: { command, description: "Check workspace" },
      _meta: { permission: { version: 1, title: command, defaultToNo: true } },
    })
    expect(parsed.command).toBe(command)
    expect(parsed.description).toBe("Check workspace")
    expect(parsed.defaultToNo).toBe(true)
  })

  it("does not treat a generic MCP payload as a shell command", () => {
    expect(
      parsePermissionToolCall({
        title: "Search",
        rawInput: { args: { payload: '{"query":"hello"}' } },
      }).command
    ).toBeNull()
    expect(normalizeToolName("PowerShell")).toBe("bash")
    expect(normalizeToolName("powershell")).toBe("bash")
  })

  it("keeps approval explicit and the default-to-no choice after the title fix", () => {
    const respond = vi.fn()
    const command = "[ -f package.json ] && pnpm test"
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PermissionDialog
          agentType="claude_code"
          onRespond={respond}
          permission={{
            request_id: "approve",
            tool_call: {
              title: command,
              kind: "execute",
              rawInput: { command, description: "Check workspace" },
              _meta: {
                permission: { version: 1, title: command, defaultToNo: true },
              },
            },
            options: [
              { option_id: "yes", name: "Allow", kind: "allow_once" },
              { option_id: "no", name: "Reject", kind: "reject_once" },
            ],
          }}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByText("Check workspace")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject" }).className).toContain(
      "bg-primary"
    )
    expect(respond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Allow" }))
    expect(respond).toHaveBeenCalledWith("approve", "yes")
  })
})

describe("selected upstream: independent Rust contracts and scope", () => {
  it.each([
    ["parsers/pi.rs", "pi-model-window"],
    ["office_watch/mod.rs", "office-watch-reap"],
  ])("wires %s to %s", (path, contract) => {
    expect(source(`src-tauri/src/${path}`)).toContain(`${contract}.contract.rs`)
    expect(source(`src/maxcode-contracts/${contract}.contract.rs`)).toContain(
      "#[test]"
    )
  })

  it("keeps reviewed adapter pins and official runtime routing", () => {
    const registry = source("src-tauri/src/acp/registry.rs")
    for (const pin of [
      "claude-agent-acp@0.81.0",
      "codex-acp@1.13.0",
      "grok@1.0.34",
      "pi-acp@0.0.33",
      "qodercli@1.1.49",
    ])
      expect(registry).toContain(pin)
    expect(source("src-tauri/src/acp/connection.rs")).toContain(
      "agent_auto_updates::managed_runtime(agent_type)"
    )
  })
})
