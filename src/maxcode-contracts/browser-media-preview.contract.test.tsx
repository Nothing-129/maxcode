import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ArtifactPreview } from "@/components/files/artifact-preview"
import { mediaPreviewKind } from "@/lib/language-detect"

const api = vi.hoisted(() => ({
  createWorkspaceMediaUrl: vi.fn(),
  downloadWorkspaceFile: vi.fn(),
}))
vi.mock("@/lib/api", () => api)
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
beforeEach(() => {
  vi.clearAllMocks()
  api.createWorkspaceMediaUrl.mockResolvedValue("/api/workspace_media/test")
  api.downloadWorkspaceFile.mockResolvedValue({ status: "started" })
})
describe("browser file access contract", () => {
  it("streams MOV inline and retains download after codec failure", async () => {
    const { container } = render(<ArtifactPreview path="/repo/录屏.MOV" />)
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull())
    const video = container.querySelector("video")!
    expect(video.getAttribute("src")).toBe("/api/workspace_media/test")
    expect(video.hasAttribute("playsinline")).toBe(true)
    fireEvent.error(video)
    expect(screen.getByRole("alert")).toHaveTextContent("playbackFailed")
    fireEvent.click(screen.getByRole("button", { name: "download" }))
    await waitFor(() =>
      expect(api.downloadWorkspaceFile).toHaveBeenCalledWith(
        "/repo",
        "录屏.MOV",
        "录屏.MOV"
      )
    )
  })
  it("downloads archives without requesting a media stream", async () => {
    render(<ArtifactPreview path="/repo/output.zip" />)
    expect(screen.getByText("downloadHint")).toBeInTheDocument()
    expect(api.createWorkspaceMediaUrl).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "download" }))
    await waitFor(() => expect(api.downloadWorkspaceFile).toHaveBeenCalled())
  })
  it("offers download even when media access fails", async () => {
    api.createWorkspaceMediaUrl.mockRejectedValue(new Error("expired"))
    render(<ArtifactPreview path="/repo/voice.mp3" />)
    expect(await screen.findByRole("alert")).toHaveTextContent("expired")
    expect(screen.getByRole("button", { name: "download" })).toBeEnabled()
    expect(mediaPreviewKind("voice.M4A")).toBe("audio")
    expect(mediaPreviewKind("file.zip")).toBeNull()
  })
})
