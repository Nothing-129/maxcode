import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ read: vi.fn(), external: vi.fn() }))
vi.mock("@/lib/api", () => ({
  readWorkspaceFileBase64: mocks.read,
  readFileBase64: mocks.external,
}))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/components/ai-elements/link-safety", () => ({
  useStreamdownLinkSafety: () => ({ enabled: false }),
  parseLocalFileTarget: () => null,
}))
vi.mock("@/components/message/image-actions", () => ({
  ImageActions: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  useImageActions: () => ({ canCopy: false, copy: vi.fn(), download: vi.fn() }),
}))

import { MessageResponse } from "@/components/ai-elements/message"
import { MarkdownImageProvider } from "@/components/ai-elements/markdown-local-image"
import { LOCAL_IMAGE_MAX_BYTES } from "@/lib/markdown-local-image"

const path =
  "/Users/nothng/Documents/Codex/codex-quota-display/data/board-review-hd.png"
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6TAAAAABJRU5ErkJggg=="
function preview(source = path, root = "/chat-sessions/session-1631") {
  return (
    <MarkdownImageProvider rootPath={root}>
      <MessageResponse>{`![新版预览](<${source}>)`}</MessageResponse>
    </MarkdownImageProvider>
  )
}

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue(PNG)
  mocks.external.mockReset().mockResolvedValue(PNG)
})

describe("external transcript image consent", () => {
  it("shows the exact file and reads only after a click, then supports zoom", async () => {
    render(preview())
    expect(screen.getByText(path)).toBeVisible()
    expect(screen.getByText("externalImageNotice")).toBeVisible()
    expect(mocks.external).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "loadExternalImage" }))
    await screen.findByRole("button", { name: "新版预览" })
    expect(mocks.external).toHaveBeenCalledExactlyOnceWith(
      path,
      LOCAL_IMAGE_MAX_BYTES
    )
    expect(screen.getByRole("img", { name: "新版预览" })).toHaveAttribute(
      "src",
      `data:image/png;base64,${PNG}`
    )
    fireEvent.click(screen.getByRole("button", { name: "新版预览" }))
    expect(screen.getByRole("dialog")).toBeVisible()
  })

  it("explains read failure and permits an explicit retry", async () => {
    mocks.external.mockRejectedValueOnce(new Error("missing"))
    render(preview())
    fireEvent.click(screen.getByRole("button", { name: "loadExternalImage" }))
    await screen.findByText("localImageFailed")
    fireEvent.click(screen.getByRole("button", { name: "loadExternalImage" }))
    await screen.findByRole("button", { name: "新版预览" })
    expect(mocks.external).toHaveBeenCalledTimes(2)
  })

  it("requires fresh consent for another source or transcript and discards stale reads", async () => {
    let finish!: (value: string) => void
    mocks.external.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    const { rerender } = render(preview())
    fireEvent.click(screen.getByRole("button", { name: "loadExternalImage" }))
    rerender(preview("/another/preview.png"))
    await act(async () => {
      finish(PNG)
    })
    expect(
      screen.queryByRole("button", { name: "新版预览" })
    ).not.toBeInTheDocument()
    expect(mocks.external).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "loadExternalImage" }))
    await screen.findByRole("button", { name: "新版预览" })
    rerender(preview("/another/preview.png", "/another-session"))
    expect(
      screen.getByRole("button", { name: "loadExternalImage" })
    ).toBeVisible()
    expect(mocks.external).toHaveBeenCalledTimes(2)
  })

  it.each([
    "../secret.png",
    "file://server/share/secret.png",
    "/tmp/secrets.json",
    "javascript:secret.png",
  ])("never offers broader access for %s", async (source) => {
    render(preview(source))
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    )
    expect(
      screen.queryByRole("button", { name: "loadExternalImage" })
    ).not.toBeInTheDocument()
    expect(mocks.external).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
