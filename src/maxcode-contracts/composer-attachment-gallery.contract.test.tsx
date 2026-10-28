import { createRef, useState } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it } from "vitest"
import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"
import { ComposerImageThumbnails } from "@/components/chat/composer/composer-image-thumbnails"
import {
  ATTACHMENT_CARD_CLASS,
  ATTACHMENT_REMOVE_CLASS,
} from "@/components/chat/composer/attachment-card"
import type { ImageInputAttachment } from "@/components/chat/message-input-attachments"
import en from "@/i18n/messages/en.json"

afterEach(async () => {
  cleanup()
  await new Promise((resolve) => setTimeout(resolve, 10))
})

async function mount() {
  const ref = createRef<RichComposerHandle>()
  function Composer() {
    const [images, setImages] = useState<ImageInputAttachment[]>([
      {
        id: "screenshot",
        type: "image",
        name: "设计参考.png",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        uri: null,
      },
    ])
    return (
      <NextIntlClientProvider locale="en" messages={en}>
        <RichComposer
          ref={ref}
          attachmentsPresent={images.length > 0}
          attachmentContent={
            <ComposerImageThumbnails
              attachments={images}
              onRemove={(id) =>
                setImages((current) =>
                  current.filter((image) => image.id !== id)
                )
              }
            />
          }
        />
      </NextIntlClientProvider>
    )
  }
  const view = render(<Composer />)
  await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
  await act(async () => {
    ref.current!.insertReference({
      refType: "file",
      id: "/tmp/通话测试记录.json",
      label: "通话测试记录.json",
      uri: "file:///tmp/record.json",
      meta: { fileKind: "file" },
    })
    ref.current!.insertTextAtCursor("分析这些附件")
  })
  return { ...view, ref }
}

describe("composer unified attachment gallery", () => {
  it("lays out image and file cards as siblings in one wrapping tray with matching surfaces and controls", async () => {
    const { container } = await mount()
    expect(container.querySelectorAll("[data-attachment-tray]")).toHaveLength(1)
    const image = container.querySelector("[data-attachment-tile]")!
    const file = container.querySelector("[data-editor-file-card]")!
    expect(image.parentElement).toBe(file.parentElement)
    expect(image.parentElement).toHaveClass("flex", "flex-wrap", "gap-2")
    for (const card of [image, file]) {
      expect(card).toHaveClass("w-56", "max-w-full", "shrink-0")
      expect(
        card.querySelector("[data-image-actions], [data-composer-file-card]")
      ).toHaveClass(...ATTACHMENT_CARD_CLASS.split(" "))
      expect(card.querySelector('button[aria-label^="Remove"]')).toHaveClass(
        ...ATTACHMENT_REMOVE_CLASS.split(" ")
      )
    }
    expect(screen.getByText("设计参考.png")).toHaveClass("truncate")
    await waitFor(() => {
      expect(screen.getByText("PNG")).toBeVisible()
      expect(screen.getByText("JSON")).toBeVisible()
    })
  })

  it("keeps the tray and the other card stable as either kind is removed", async () => {
    const { container, ref } = await mount()
    const tray = container.querySelector("[data-attachment-tray]")!
    const file = container.querySelector("[data-editor-file-card]")!
    fireEvent.click(screen.getByRole("button", { name: "Remove 设计参考.png" }))
    await waitFor(() =>
      expect(container.querySelector("[data-attachment-tile]")).toBeNull()
    )
    expect(container.querySelector("[data-editor-file-card]")).toBe(file)
    expect(tray).not.toHaveAttribute("inert")
    fireEvent.click(
      screen.getByRole("button", { name: "Remove 通话测试记录.json" })
    )
    expect(container.querySelector("[data-attachment-tray]")).toBe(tray)
    expect(tray).toHaveAttribute("inert")
    expect(ref.current!.getText()).toBe("分析这些附件")
  })
})
