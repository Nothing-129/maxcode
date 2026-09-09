import { type ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

/**
 * rg/grep "found nothing" used to render as a red failed tool call (exit 1)
 * and inflate the tool-group "N failed" suffix. These cards must read as an
 * empty search, not an error; a real diagnostic (JSON parse, regex, …) stays
 * on the error path.
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

vi.mock("@/components/ai-elements/code-block", () => ({
  CodeBlock: ({ code }: { code: string }) => (
    <pre data-testid="code-block">{code}</pre>
  ),
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
      <ContentPartsRenderer parts={parts} role="assistant" />
    </NextIntlClientProvider>
  )
  for (const button of screen.getAllByRole("button")) {
    fireEvent.click(button)
  }
  return result
}

describe("search no-match presentation", () => {
  it("does not mark a shell rg miss as failed in the tool group", () => {
    const envelope = JSON.stringify({
      exit_code: 1,
      formatted_output: "",
    })
    renderParts([
      {
        type: "tool-group",
        isStreaming: false,
        items: [
          {
            type: "tool-call",
            toolCallId: "rg-1",
            toolName: "bash",
            input: JSON.stringify({
              command: "rg -n 'SdkAppId|Callback' src",
            }),
            state: "output-error",
            output: envelope,
            errorText: envelope,
          },
          {
            type: "tool-call",
            toolCallId: "web-1",
            toolName: "web_search",
            input: JSON.stringify({ query: "DescribeSdkAppId" }),
            state: "output-available",
            output: "ok",
          },
        ],
      },
    ])

    expect(screen.getByText(/Ran 1 command/)).toBeInTheDocument()
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument()
    expect(screen.queryByText("Error")).not.toBeInTheDocument()
  })

  it("keeps a shell rg that threw a parse error as a failure", () => {
    const traceback =
      "json.decoder.JSONDecodeError: Expecting property name " +
      "enclosed in double quotes: line 17 column 27 (char 557)"
    renderParts([
      {
        type: "tool-group",
        isStreaming: false,
        items: [
          {
            type: "tool-call",
            toolCallId: "rg-1",
            toolName: "bash",
            input: JSON.stringify({ command: "rg -n 'SdkAppId' src" }),
            state: "output-error",
            output: traceback,
            errorText: traceback,
          },
        ],
      },
    ])

    expect(screen.getByText(/1 execution issue/)).toBeInTheDocument()
    expect(screen.getByText("Error")).toBeInTheDocument()
  })
})
