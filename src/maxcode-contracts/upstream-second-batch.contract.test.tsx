import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { RichComposerHandle } from "@/components/chat/composer/rich-composer"
import type { ImageInputAttachment } from "@/components/chat/message-input-attachments"
import { source } from "./contract-source"

const upload = vi.hoisted(() => vi.fn())
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/lib/api", () => ({
  uploadAttachment: upload,
  isEmptyAttachmentError: () => false,
  UPLOAD_I18N_KEY_QUOTA_EXCEEDED: "quota",
  UPLOAD_MAX_BYTES: 104_857_600,
}))
import { useComposerAttachments } from "@/components/chat/composer/use-composer-attachments"

const original: ImageInputAttachment = {
  id: "screenshot",
  type: "image",
  data: "b3JpZ2luYWw=",
  uri: "file:///uploads/original.png",
  name: "screen.png",
  mimeType: "image/png",
}
const marks = [{ kind: "box" as const, x: 10, y: 20, width: 40, height: 30 }]
function setup() {
  const hook = renderHook(() =>
    useComposerAttachments({
      editorRef: { current: null as RichComposerHandle | null },
      attachmentTabId: "conversation-42",
      promptCapabilities: { image: true, embedded_context: true },
    })
  )
  act(() => hook.result.current.setAttachments([original]))
  return hook
}
afterEach(() => upload.mockReset())

describe("MaxCode second upstream batch", () => {
  it("uploads marked bytes and replaces the old URI before allowing send", async () => {
    let finish!: (value: { path: string }) => void
    upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const { result } = setup()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.replaceImageAttachment(
        original.id,
        new Blob(["marked"], { type: "image/png" }),
        "1. box",
        marks
      )
    })
    await waitFor(() => expect(upload).toHaveBeenCalled())
    expect(result.current.hasUploadingImage).toBe(true)
    expect(upload.mock.calls[0][1]).toBe("conversation-42")
    await act(async () => {
      finish({ path: "/uploads/marked.png" })
      await pending
    })
    expect(result.current.hasUploadingImage).toBe(false)
    expect(result.current.imagePromptBlocks()).toEqual([
      {
        type: "image",
        data: "bWFya2Vk",
        mime_type: "image/png",
        uri: "file:///uploads/marked.png",
      },
      { type: "text", text: "1. box" },
    ])
    expect(result.current.imageAttachments[0].markupSource).toEqual({
      data: original.data,
      mime: original.mimeType,
      marks,
    })
    act(() => result.current.removeAttachment(original.id))
    expect(result.current.imagePromptBlocks()).toEqual([])
  })

  it("keeps original bytes, URI and sendability after an upload failure", async () => {
    upload.mockRejectedValue(new Error("quota"))
    const { result } = setup()
    await act(async () => {
      await expect(
        result.current.replaceImageAttachment(
          original.id,
          new Blob(["new"], { type: "image/png" }),
          "notes",
          marks
        )
      ).rejects.toThrow("quota")
    })
    expect(result.current.imageAttachments).toEqual([original])
    expect(result.current.hasUploadingImage).toBe(false)
  })

  it("does not resurrect an image removed while its replacement uploads", async () => {
    let finish!: (value: { path: string }) => void
    upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const { result } = setup()
    let pending!: Promise<void>
    act(() => {
      pending = result.current.replaceImageAttachment(
        original.id,
        new Blob(["new"], { type: "image/png" }),
        "notes",
        marks
      )
    })
    await waitFor(() => expect(upload).toHaveBeenCalled())
    act(() => result.current.clearAttachments())
    await act(async () => {
      finish({ path: "/uploads/new.png" })
      await pending
    })
    expect(result.current.imagePromptBlocks()).toEqual([])
  })

  it("updates only the selected adapter pins and retains Grok session routing", () => {
    const registry = source("src-tauri/src/acp/registry.rs")
    expect(registry).toContain("@xai-official/grok@1.0.41")
    expect(registry).toContain("agy-acp-server-1.2.1-darwin-x86_64.zip")
    expect(registry).toContain("ClaimNullSessionIds")
  })

  it("preserves Electron ownership while probing standalone update targets", () => {
    expect(source("src-tauri/src/web/handlers/web_server.rs")).toContain(
      "!crate::update::runtime::is_electron()"
    )
    expect(source("src-tauri/src/update/install.rs")).toContain(
      "crate::update::runtime::ensure_server_owned_update()?"
    )
    const status = source("src/components/layout/status-bar-update.tsx")
    expect(status).toContain("usesElectronInstaller()")
    expect(status).toContain("selfUpdateBlocker")
    expect(status).toContain('role="status"')
  })
})
