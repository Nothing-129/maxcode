import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import { ProgressSections } from "@/components/message/progress-sections"
import { annotateToolRecovery } from "@/lib/tool-call-recovery"
import type {
  AdaptedContentPart,
  AdaptedToolCallPart,
} from "@/lib/adapters/ai-elements-adapter"

const failed: AdaptedToolCallPart = {
  type: "tool-call",
  toolCallId: "failed",
  toolName: "exec_command",
  input: JSON.stringify({ cmd: "cat config.json", workdir: "/project" }),
  state: "output-error",
  errorText: "Permission denied",
  output: "Permission denied",
}
const success: AdaptedToolCallPart = {
  ...failed,
  toolCallId: "retry",
  state: "output-available",
  errorText: undefined,
  output: "{}",
}
function recovered(calls: AdaptedToolCallPart[]) {
  return (annotateToolRecovery(calls)[0] as AdaptedToolCallPart).recoveredBy
}
function tree(parts: AdaptedContentPart[], sections = false) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {sections ? (
        <ProgressSections parts={parts} isStreaming={false} />
      ) : (
        <ContentPartsRenderer parts={parts} role="assistant" />
      )}
    </NextIntlClientProvider>
  )
}

describe("MaxCode contract: confirmed read retries retain error history", () => {
  it("annotates a later identical success without changing original evidence", () => {
    const [result] = annotateToolRecovery([failed, success])
    expect(result).toEqual({ ...failed, recoveredBy: "retry" })
    expect(failed.recoveredBy).toBeUndefined()
    expect(recovered([success, failed])).toBeUndefined()
  })
  it("keeps a later failure unresolved and compares nested read arguments without losing values", () => {
    const calls = annotateToolRecovery([
      failed,
      success,
      { ...failed, toolCallId: "later-failure" },
    ]) as AdaptedToolCallPart[]
    expect(calls[0].recoveredBy).toBe("retry")
    expect(calls[2].recoveredBy).toBeUndefined()
    const readFailure = {
      ...failed,
      toolName: "Read",
      input: '{"file_path":"config.json","options":{"offset":1}}',
    }
    expect(
      recovered([
        readFailure,
        {
          ...success,
          toolName: "Read",
          input: '{"options":{"offset":2},"file_path":"config.json"}',
        },
      ])
    ).toBeUndefined()
    expect(
      recovered([
        readFailure,
        {
          ...success,
          toolName: "Read",
          input: '{"options":{"offset":1},"file_path":"config.json"}',
        },
      ])
    ).toBe("retry")
  })
  it("does not confuse unrelated, unfinished, failed or argument-less calls with recovery", () => {
    for (const retry of [
      {
        ...success,
        input: JSON.stringify({ cmd: "cat other.json", workdir: "/project" }),
      },
      {
        ...success,
        input: JSON.stringify({ cmd: "cat config.json", workdir: "/other" }),
      },
      { ...success, toolStatus: "in_progress" },
      { ...success, toolStatus: "failed" },
      { ...success, state: "input-available" as const },
      { ...success, errorText: "still broken" },
      { ...success, input: null },
      { ...success, toolCallId: failed.toolCallId },
    ])
      expect(recovered([failed, retry])).toBeUndefined()
    expect(
      recovered([
        { ...failed, input: "{}" },
        { ...success, input: "{}" },
      ])
    ).toBeUndefined()
  })
  it("does not infer that changed Python scripts or compound shell commands fixed a prior failure", () => {
    for (const cmd of [
      "python3 check.py",
      "cat config.json; true",
      "cat $(pwd)/config.json",
    ]) {
      const input = JSON.stringify({ cmd })
      expect(
        recovered([
          { ...failed, input },
          { ...success, input },
        ])
      ).toBeUndefined()
    }
  })
  it("shows retry success in the group but keeps unresolved execution issues neutral and raw errors available", () => {
    render(
      tree([
        {
          type: "tool-group",
          isStreaming: false,
          items: [
            failed,
            success,
            {
              ...failed,
              toolCallId: "other",
              input: '{"cmd":"cat missing.json"}',
            },
          ],
        },
      ])
    )
    expect(screen.getByText(/1 retried successfully/)).toBeInTheDocument()
    const remaining = screen.getByText(/1 execution issue/)
    expect(remaining).toHaveClass("text-muted-foreground")
    expect(remaining).not.toHaveClass("text-destructive")
    fireEvent.click(
      screen.getByRole("button", { name: /retried successfully/ })
    )
    expect(screen.getByText("Retry succeeded")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: /Retry succeeded/ }))
    expect(screen.getAllByText(/Permission denied/).length).toBeGreaterThan(0)
  })
  it.each([true, false])(
    "uses a neutral summary for the screenshot's failed preference probe (streaming=%s)",
    (isStreaming) => {
      const probe = {
        ...failed,
        input: JSON.stringify({
          cmd: "sw_vers; defaults -currentHost read com.apple.coreservices.useractivityd 2>/dev/null",
        }),
        output: JSON.stringify({
          exit_code: 1,
          formatted_output: "ProductName: macOS",
        }),
        errorText: undefined,
      }
      render(
        tree([
          {
            type: "tool-group",
            isStreaming,
            items: [
              probe,
              {
                ...success,
                toolCallId: "settings-ui",
                toolName: "cua_repl",
                input: "{}",
                output: "Settings opened",
              },
            ],
          },
        ])
      )
      const summary = screen.getByText(/1 execution issue/)
      expect(summary).toHaveAttribute("data-tool-execution-issues")
      expect(summary).not.toHaveClass("text-destructive")
      expect(screen.queryByText(/retried successfully/)).toBeNull()
      fireEvent.click(screen.getByRole("button", { name: /1 execution issue/ }))
      expect(screen.getByText("Error")).toBeVisible()
      fireEvent.click(screen.getByRole("button", { name: /Error/ }))
      expect(screen.getAllByText(/ProductName: macOS/).length).toBeGreaterThan(
        0
      )
    }
  )
  it("removes a confirmed retry from the red failure summary across prose boundaries", () => {
    render(
      tree(
        [
          { type: "tool-group", isStreaming: false, items: [failed] },
          { type: "text", text: "Trying the same read again" },
          { type: "tool-group", isStreaming: false, items: [success] },
        ],
        true
      )
    )
    expect(screen.queryByText(/1 execution issue/)).toBeNull()
    expect(screen.getByText(/1 retried successfully/)).not.toHaveClass(
      "text-destructive"
    )
  })
})
