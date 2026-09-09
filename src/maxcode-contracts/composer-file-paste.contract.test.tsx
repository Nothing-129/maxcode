import { act, render, waitFor } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"
import {
  filesFromClipboard,
  imageFilesFromClipboardApi,
} from "@/lib/clipboard-images"

describe("MaxCode contract: attachment paste during IME input", () => {
  it.each(["image/png", "application/pdf"])(
    "delivers %s once while the input method is composing",
    async (type) => {
      const ref = createRef<RichComposerHandle>()
      const received: File[] = []
      const onPasteFiles = vi.fn((event: ClipboardEvent) => {
        received.push(...filesFromClipboard(event.clipboardData))
        return true
      })
      render(<RichComposer ref={ref} onPasteFiles={onPasteFiles} />)
      await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
      const view = ref.current!.getEditor()!.view
      const file = new File(["attachment"], "example", { type })
      act(() => {
        view.dom.dispatchEvent(new CompositionEvent("compositionstart"))
      })
      expect(view.composing).toBe(true)
      const event = new Event("paste", { bubbles: true, cancelable: true })
      Object.defineProperty(event, "clipboardData", {
        value: { files: [file], getData: () => "" },
      })
      act(() => {
        view.dom.dispatchEvent(event)
      })
      expect(received).toEqual([file])
      expect(onPasteFiles).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
      expect(ref.current!.isEmpty()).toBe(true)
    }
  )

  it("leaves composing text to the input method without a duplicate callback", async () => {
    const ref = createRef<RichComposerHandle>()
    const onPasteFiles = vi.fn(() => false)
    render(<RichComposer ref={ref} onPasteFiles={onPasteFiles} />)
    await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
    const view = ref.current!.getEditor()!.view
    act(() => {
      view.dom.dispatchEvent(new CompositionEvent("compositionstart"))
    })
    const event = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", {
      value: { files: [], getData: () => "中文" },
    })
    act(() => {
      view.dom.dispatchEvent(event)
    })
    expect(onPasteFiles).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
    expect(ref.current!.isEmpty()).toBe(true)
  })
})

describe("MaxCode contract: Electron screenshot clipboard", () => {
  it("reads a native screenshot when browser clipboard access is blocked", async () => {
    const read = vi.fn().mockRejectedValue(new Error("Permission denied"))
    const readClipboardImage = vi
      .fn()
      .mockResolvedValue("data:image/png;base64,aW1hZ2U=")
    vi.stubGlobal("maxcodeElectron", { readClipboardImage })
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { read },
    })
    try {
      const files = await imageFilesFromClipboardApi()
      expect(files).toHaveLength(1)
      expect(files[0].type).toBe("image/png")
      expect(files[0].size).toBe(5)
      expect(readClipboardImage).toHaveBeenCalledOnce()
      expect(read).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      if (previous) Object.defineProperty(navigator, "clipboard", previous)
      else Reflect.deleteProperty(navigator, "clipboard")
    }
  })

  it("does not retry browser image reads when native clipboard has text or no image", async () => {
    vi.stubGlobal("maxcodeElectron", {
      readClipboardImage: vi.fn().mockResolvedValue(null),
    })
    try {
      expect(await imageFilesFromClipboardApi()).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
