import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { RichComposerHandle } from "./rich-composer"

const uploadAttachment = vi.hoisted(() => vi.fn())
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/lib/api", () => ({
  uploadAttachment,
  isEmptyAttachmentError: () => false,
  UPLOAD_I18N_KEY_QUOTA_EXCEEDED: "quota",
  UPLOAD_MAX_BYTES: 104_857_600,
}))

import { useComposerAttachments } from "./use-composer-attachments"

afterEach(() => {
  vi.restoreAllMocks()
  uploadAttachment.mockReset()
  Reflect.deleteProperty(window, "maxcodeElectron")
})

describe("composer attachments on Electron", () => {
  it("keeps images gated until the HTTP upload supplies a server path", async () => {
    Object.defineProperty(window, "maxcodeElectron", {
      configurable: true,
      value: { platform: "darwin" },
    })
    let finishUpload!: (value: { path: string }) => void
    uploadAttachment.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve
        })
    )
    const { result } = renderHook(() =>
      useComposerAttachments({
        editorRef: { current: null as RichComposerHandle | null },
        attachmentTabId: "conversation-7",
        promptCapabilities: { image: true, embedded_context: true },
      })
    )
    const image = new File(["image bytes"], "screen.png", { type: "image/png" })
    let pending!: Promise<void>
    act(() => {
      pending = result.current.appendFilesFromInput([image])
    })
    await waitFor(() =>
      expect(uploadAttachment).toHaveBeenCalledWith(image, "conversation-7")
    )
    expect(result.current.hasUploadingImage).toBe(true)
    expect(result.current.imageAttachments[0].uri).toBeNull()

    await act(async () => {
      finishUpload({ path: "/uploads/session-7/screen.png" })
      await pending
    })
    expect(result.current.hasUploadingImage).toBe(false)
    expect(result.current.imagePromptBlocks()[0]).toMatchObject({
      type: "image",
      uri: "file:///uploads/session-7/screen.png",
    })
  })

  it("opens the DOM file picker for local uploads", async () => {
    Object.defineProperty(window, "maxcodeElectron", {
      configurable: true,
      value: { platform: "darwin", openFileDialog: vi.fn() },
    })
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {})
    const { result } = renderHook(() =>
      useComposerAttachments({
        editorRef: { current: null as RichComposerHandle | null },
        promptCapabilities: { image: true, embedded_context: true },
      })
    )
    await result.current.handleUploadLocalFiles()
    expect(click).toHaveBeenCalledTimes(1)
    expect(window.maxcodeElectron?.openFileDialog).not.toHaveBeenCalled()
  })
})
