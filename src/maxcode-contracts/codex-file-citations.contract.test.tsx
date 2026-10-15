import { fireEvent, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// End-to-end guard for plain-text local paths in assistant markdown (the
// build-artifact table an agent writes at the end of a reply). Exercises the
// REAL Streamdown pipeline — parse → remarkAutolinkLocalPaths → sanitize →
// harden — so the assertions prove the minted `codeg://file/…` and
// `/C:/…` hrefs survive to MarkdownLink as file badges, and that clicks
// route into the workspace file opener exactly like an agent-written file
// link would.
const mocks = vi.hoisted(() => ({
  openFilePreview: vi.fn(),
  openUrl: vi.fn(),
  openPath: vi.fn(),
  isLocalDesktop: vi.fn(() => false),
  toastError: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}))

vi.mock("@/lib/platform", () => ({
  openUrl: mocks.openUrl,
  openPath: mocks.openPath,
  isLocalDesktop: mocks.isLocalDesktop,
}))

vi.mock("@/lib/transport", () => ({
  isDesktop: vi.fn(() => false),
  getActiveRemoteConnectionId: vi.fn(() => null),
}))

vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: { path: "/repo" } }),
}))

vi.mock("@/contexts/workspace-context", () => ({
  useWorkspaceActions: () => ({ openFilePreview: mocks.openFilePreview }),
}))

import { MessageResponse } from "@/components/ai-elements/message"

function fileBadges(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      "button[data-resource-kind='file']"
    )
  )
}

describe("Codex source citations", () => {
  beforeEach(() => {
    mocks.openFilePreview.mockReset()
    mocks.openFilePreview.mockResolvedValue(undefined)
    mocks.openPath.mockReset()
    mocks.isLocalDesktop.mockReturnValue(false)
  })

  it("shows spreadsheet locations and opens the exact file", async () => {
    const path =
      "/Users/me/Library/Application Support/app.codeg/uploads/润通1015.xlsx"
    mocks.openFilePreview.mockResolvedValue(undefined)
    const { container } = render(
      <MessageResponse>
        {`:codex-file-citation{path="${path}" purpose="source" sheet="新增起诉户" range="D48"}`}
      </MessageResponse>
    )
    await waitFor(() => expect(fileBadges(container)).toHaveLength(1))
    expect(container.textContent).toContain("润通1015.xlsx · 新增起诉户 · D48")
    expect(container.textContent).not.toContain("codex-file-citation")
    expect(container.textContent).not.toContain("Application Support")
    fireEvent.click(fileBadges(container)[0])
    await waitFor(() =>
      expect(mocks.openFilePreview).toHaveBeenCalledWith(path, {
        line: undefined,
      })
    )
  })

  it("previews a generated PDF using the complete spaced CJK path on desktop", async () => {
    const path =
      "/Users/me/Library/Application Support/app.codeg/output/云客 CRM 接口文档.pdf"
    mocks.isLocalDesktop.mockReturnValue(true)
    const { container } = render(
      <MessageResponse>
        {`:codex-file-citation{path="${path}" purpose="output"}`}
      </MessageResponse>
    )
    await waitFor(() => expect(fileBadges(container)).toHaveLength(1))
    expect(fileBadges(container)[0]).toHaveAttribute("title", path)
    expect(container.textContent).toContain("云客 CRM 接口文档.pdf")
    expect(container.textContent).not.toContain("codex-file-citation")
    fireEvent.click(fileBadges(container)[0])
    await waitFor(() =>
      expect(mocks.openFilePreview).toHaveBeenCalledWith(path, {
        line: undefined,
      })
    )
    expect(mocks.openPath).not.toHaveBeenCalled()
  })
})
