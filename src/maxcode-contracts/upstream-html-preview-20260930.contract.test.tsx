import type { ReactNode } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import en from "@/i18n/messages/en.json"

const api = vi.hoisted(() => ({
  readFileBase64: vi.fn(),
  readWorkspaceFileBase64: vi.fn(),
  getHomeDirectory: vi.fn(),
  listDirectoryEntries: vi.fn(),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}))
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}))
vi.mock("@/components/ai-elements/link-safety", () => ({
  FilePathLink: ({
    children,
    filePath,
  }: {
    children: ReactNode
    filePath: string
  }) => <span data-open-path={filePath}>{children}</span>,
  useStreamdownLinkSafety: () => ({ enabled: false }),
}))
vi.mock("@/components/ai-elements/code-block", () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}))
vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({
    children,
    linkMode,
  }: {
    children: string
    linkMode?: string
  }) => <div data-link-mode={linkMode}>{children}</div>,
}))

import { MarkdownImageProvider } from "@/components/ai-elements/markdown-local-image"
import { ContentPartsRenderer } from "@/components/message/content-parts-renderer"
import { SharedConversationView } from "@/components/conversations/shared-conversation-view"
import { resetCodexVisualizeAssetsForTests } from "@/components/message/codex-visualize-card"

const encoded = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
const marker = (path: string) => `visualize${JSON.stringify({ path })}`
const fragment = '<div class="card">Original chart</div><script>draw()</script>'

function Transcript({
  text,
  root = "/conversation",
  user = false,
  streaming = false,
}: {
  text: string
  root?: string | null
  user?: boolean
  streaming?: boolean
}) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <MarkdownImageProvider rootPath={root}>
        <ContentPartsRenderer
          role={user ? "user" : "assistant"}
          parts={[{ type: "text", text }]}
          isStreaming={streaming}
        />
      </MarkdownImageProvider>
    </NextIntlClientProvider>
  )
}

async function frame() {
  return waitFor(() => {
    const node = document.querySelector("iframe")
    if (!node) throw new Error("Preview still loading")
    return node
  })
}

beforeEach(() => {
  resetCodexVisualizeAssetsForTests()
  vi.restoreAllMocks()
  api.readFileBase64.mockReset().mockResolvedValue(encoded(fragment))
  api.readWorkspaceFileBase64.mockReset().mockResolvedValue(encoded(fragment))
  api.getHomeDirectory.mockReset().mockResolvedValue("/home/user")
  api.listDirectoryEntries.mockReset().mockRejectedValue(new Error("No plugin"))
})

afterEach(() => {
  window.location.hash = ""
  vi.unstubAllGlobals()
})

describe("MaxCode: integrated HTML previews remain scoped and opt in", () => {
  it.each([
    fragment,
    "<!doctype html><html><head><title>Report</title></head><body><script>send()</script></body></html>",
  ])(
    "starts every HTML kind without scripts or network access",
    async (html) => {
      api.readFileBase64.mockResolvedValue(encoded(html))
      render(
        <Transcript
          text={`Introduction\n${marker("/reports/chart.html")}\nConclusion`}
        />
      )
      const preview = await frame()
      expect(preview).toHaveAttribute("sandbox", "")
      expect(preview).toHaveAttribute("referrerpolicy", "no-referrer")
      const doc = preview.getAttribute("srcdoc") ?? ""
      expect(doc).toContain("script-src 'none'")
      expect(doc).toContain("default-src 'none'")
      expect(doc).toContain("frame-src 'none'")
      expect(doc).toContain('base href="about:srcdoc"')
      expect(doc).not.toContain("codeg-visualize:size")
      expect(
        screen.getByRole("button", { name: /Enable scripts/ })
      ).toHaveAttribute("aria-pressed", "false")
      expect(document.querySelectorAll(".chat-message-text")).toHaveLength(2)
      expect(screen.getByText("Introduction")).toBeInTheDocument()
      expect(screen.getByText("Conclusion")).toBeInTheDocument()
      expect(document.querySelector("[data-open-path]")).toHaveAttribute(
        "data-open-path",
        "/reports/chart.html"
      )
    }
  )

  it("confines relative file reads and their open action to the transcript", async () => {
    const { rerender } = render(
      <Transcript text={marker("report.html")} root="/trusted" />
    )
    await frame()
    expect(api.readWorkspaceFileBase64).toHaveBeenCalledWith(
      "/trusted",
      "report.html",
      4 * 1024 * 1024
    )
    expect(api.readFileBase64).not.toHaveBeenCalled()
    expect(document.querySelector("[data-open-path]")).toHaveAttribute(
      "data-open-path",
      "/trusted/report.html"
    )
    fireEvent.click(screen.getByRole("button", { name: /Enable scripts/ }))
    await waitFor(() =>
      expect(document.querySelector("iframe")).toHaveAttribute(
        "sandbox",
        "allow-scripts"
      )
    )
    expect(document.querySelector("iframe")?.getAttribute("srcdoc")).toContain(
      "connect-src blob: data:"
    )
    expect(document.querySelector("iframe")).not.toHaveAttribute(
      "sandbox",
      expect.stringContaining("allow-same-origin")
    )

    rerender(<Transcript text={marker("report.html")} root="/untrusted" />)
    await waitFor(() =>
      expect(api.readWorkspaceFileBase64).toHaveBeenLastCalledWith(
        "/untrusted",
        "report.html",
        expect.any(Number)
      )
    )
    expect(await frame()).toHaveAttribute("sandbox", "")
    expect(document.querySelector("[data-open-path]")).toHaveAttribute(
      "data-open-path",
      "/untrusted/report.html"
    )
  })

  it("does not fall back to an unrestricted read when the workspace rejects a path", async () => {
    api.readWorkspaceFileBase64.mockRejectedValue(
      new Error("Outside workspace")
    )
    render(<Transcript text={marker("../private.html")} />)
    await screen.findByText("Outside workspace")
    expect(api.readWorkspaceFileBase64).toHaveBeenCalledWith(
      "/conversation",
      "../private.html",
      expect.any(Number)
    )
    expect(api.readFileBase64).not.toHaveBeenCalled()
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("reads an ordinary relative mention only after Preview is chosen", async () => {
    render(<Transcript text="See [the report](out/report.html)." />)
    expect(api.readFileBase64).not.toHaveBeenCalled()
    expect(api.readWorkspaceFileBase64).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }))
    await frame()
    expect(api.readWorkspaceFileBase64).toHaveBeenCalledWith(
      "/conversation",
      "out/report.html",
      expect.any(Number)
    )
    expect(api.readFileBase64).not.toHaveBeenCalled()
  })

  it("waits until a streamed reply finishes before offering file mentions", () => {
    const { rerender } = render(
      <Transcript text="See `out/report.html`." streaming />
    )
    expect(screen.queryByRole("button", { name: /Preview/ })).toBeNull()
    rerender(<Transcript text="See `out/report.html`." />)
    expect(screen.getByRole("button", { name: /Preview/ })).toBeInTheDocument()
    expect(api.readFileBase64).not.toHaveBeenCalled()
    expect(api.readWorkspaceFileBase64).not.toHaveBeenCalled()
  })

  it("inlines sibling resources through the confined file-directory reader", async () => {
    api.readFileBase64.mockResolvedValue(
      encoded(
        '<!doctype html><html><head><link rel="stylesheet" href="css/chart.css"></head><body><img src="../private.png"></body></html>'
      )
    )
    api.readWorkspaceFileBase64.mockResolvedValue(encoded(".chart{color:blue}"))
    render(<Transcript text={marker("/reports/chart.html")} />)
    const preview = await frame()
    expect(api.readWorkspaceFileBase64).toHaveBeenCalledWith(
      "/reports",
      "css/chart.css"
    )
    expect(api.readWorkspaceFileBase64).not.toHaveBeenCalledWith(
      "/reports",
      "../private.png"
    )
    expect(preview.getAttribute("srcdoc")).toContain(".chart{color:blue}")
  })

  it("keeps user messages inert and relative previews without a root unreadable", async () => {
    const { rerender } = render(
      <Transcript text={marker("/reports/chart.html")} user />
    )
    expect(screen.queryByTestId("codex-visualize-card")).toBeNull()
    expect(api.readFileBase64).not.toHaveBeenCalled()
    rerender(<Transcript text={marker("report.html")} root={null} />)
    await screen.findByText(en.Folder.chat.linkSafety.errorNoWorkspace)
    expect(api.readFileBase64).not.toHaveBeenCalled()
    expect(api.readWorkspaceFileBase64).not.toHaveBeenCalled()
    expect(document.querySelector("[data-open-path]")).toBeNull()
  })

  it("ignores stale file responses after the transcript root changes", async () => {
    let finishOld!: (data: string) => void
    api.readWorkspaceFileBase64.mockImplementation((root: string) =>
      root === "/old"
        ? new Promise<string>((resolve) => {
            finishOld = resolve
          })
        : Promise.resolve(encoded("<p>New chart</p>"))
    )
    const { rerender } = render(
      <Transcript text={marker("report.html")} root="/old" />
    )
    await waitFor(() => expect(api.readWorkspaceFileBase64).toHaveBeenCalled())
    rerender(<Transcript text={marker("report.html")} root="/new" />)
    expect((await frame()).getAttribute("srcdoc")).toContain("New chart")
    await act(async () => finishOld(encoded("<p>Old chart</p>")))
    expect((await frame()).getAttribute("srcdoc")).not.toContain("Old chart")
  })

  it("leaves public shares read only even when they name local visualizations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          title: "Shared report",
          agent_type: "codex",
          shared_at: new Date().toISOString(),
          turns: [
            {
              id: "1",
              role: "assistant",
              timestamp: new Date().toISOString(),
              blocks: [
                {
                  type: "text",
                  text: `${marker("/private/report.html")}\n[report](/private/report.html)`,
                },
              ],
            },
          ],
        }),
      })
    )
    window.location.hash = "#0123456789abcdef0123456789abcdef"
    const view = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SharedConversationView />
      </NextIntlClientProvider>
    )
    await screen.findByText("Shared report")
    expect(
      view.container.querySelector('[data-link-mode="public"]')
    ).toBeInTheDocument()
    expect(screen.queryByTestId("codex-visualize-card")).toBeNull()
    expect(
      screen.queryByRole("button", { name: /Enable scripts|Preview/ })
    ).toBeNull()
    expect(api.readFileBase64).not.toHaveBeenCalled()
    expect(api.readWorkspaceFileBase64).not.toHaveBeenCalled()
    window.location.hash = ""
    vi.unstubAllGlobals()
  })
})
