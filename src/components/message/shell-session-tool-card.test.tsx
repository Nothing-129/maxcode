import { type ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

/**
 * Codex unified-exec session cards (`wait` / `write_stdin`).
 *
 * Both address a background shell started by an earlier `exec_command`, by a
 * session id — no command of their own. That left `wait` titled "wait" and
 * `write_stdin` (which aliased to "bash") titled "bash", over a dump of
 * `cell_id / yield_time_ms / max_tokens`. The history parser now resolves the
 * id back to the command as `session_command`; these tests pin the card that
 * reads it. See `src/lib/shell-session-tool.ts`.
 */

vi.mock("@/components/ai-elements/link-safety", () => ({
  FilePathLink: ({
    filePath,
    children,
  }: {
    filePath: string
    children: ReactNode
  }) => <button data-path={filePath}>{children}</button>,
  useStreamdownLinkSafety: () => ({ enabled: false }),
}))

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div>{children}</div>
  ),
}))

import { ContentPartsRenderer } from "./content-parts-renderer"
import enMessages from "@/i18n/messages/en.json"
import type { AdaptedContentPart } from "@/lib/adapters/ai-elements-adapter"

function renderParts(parts: AdaptedContentPart[]) {
  const result = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ContentPartsRenderer expandedActivity parts={parts} role="assistant" />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getAllByRole("button")[0])
  return result
}

function sessionPart(
  toolName: string,
  input: Record<string, unknown>,
  output = ""
): AdaptedContentPart {
  return {
    type: "tool-call",
    toolCallId: "call_1",
    toolName,
    input: JSON.stringify(input),
    state: "output-available",
    output,
  }
}

function execPart(command: string, output: string): AdaptedContentPart {
  return {
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "exec_command",
    // `input_preview` of a codex `exec_command` is the bare command string.
    input: command,
    state: "output-available",
    output,
  }
}

describe("codex shell-session cards", () => {
  it("titles a wait by the command whose session it polls", () => {
    const { container } = renderParts([
      sessionPart(
        "wait",
        {
          cell_id: "7106",
          yield_time_ms: 30000,
          max_tokens: 20000,
          session_command: "cargo test --features test-utils",
        },
        "test result: ok. 1962 passed"
      ),
    ])

    expect(
      screen.getByText("Wait cargo test --features test-utils")
    ).toBeInTheDocument()
    expect(container.textContent).toContain("test result: ok. 1962 passed")
    // The command names the card; reprinting it as a shell prompt would read
    // as a re-run of the command rather than a poll on its session.
    expect(container.textContent).not.toContain("$ cargo test")
    // …and the parameter dump the card used to be is gone.
    expect(container.textContent).not.toContain("yield_time_ms")
  })

  it("falls back to the session id when the command is unknown", () => {
    renderParts([
      sessionPart("wait", { cell_id: "7106", yield_time_ms: 30000 }, "still…"),
    ])

    expect(screen.getByText("Wait cell 7106")).toBeInTheDocument()
  })

  it("renders a terminating wait as a terminate, not a wait", () => {
    renderParts([
      sessionPart(
        "wait",
        { cell_id: "42", terminate: true, session_command: "pnpm dev" },
        ""
      ),
    ])

    expect(screen.getByText("Terminate pnpm dev")).toBeInTheDocument()
  })

  it("treats an empty write_stdin as the poll it is", () => {
    const { container } = renderParts([
      sessionPart(
        "write_stdin",
        { session_id: 33067, chars: "", session_command: "pnpm test" },
        " RUN  v2.1.9"
      ),
    ])

    expect(screen.getByText("Wait pnpm test")).toBeInTheDocument()
    expect(container.textContent).toContain("RUN  v2.1.9")
    // Regression: `write_stdin` aliased to "bash", whose title derivation found
    // no command in `{session_id, chars}` and fell back to the raw tool name.
    expect(container.textContent).not.toContain("bash")
  })

  it("shows the keystrokes an interrupting write_stdin sent", () => {
    renderParts([
      sessionPart("write_stdin", {
        session_id: 33067,
        chars: "\u0003",
        session_command: "pnpm dev",
      }),
    ])

    expect(screen.getByText("Stdin ^C")).toBeInTheDocument()
  })

  it("names the session a command left running next to its title", () => {
    // One session is polled by any number of `wait` cards, and this echo is
    // the shape the parser cannot resolve — so both ends have to show the id
    // for them to be matched up: "Wait cell 17983" against this card.
    renderParts([
      execPart(
        "npx --yes playwright@1.62.1 install chromium",
        "\nSESSION_ID=17983"
      ),
    ])

    expect(
      screen.getByText("npx --yes playwright@1.62.1 install chromium")
    ).toBeInTheDocument()
    expect(screen.getByText("Session 17983")).toBeInTheDocument()
  })

  it("leaves a command that started no session unlabelled", () => {
    renderParts([execPart("cargo build", "Compiling codeg v0.22.2")])

    expect(screen.queryByText(/^Session /)).toBeNull()
  })
})
