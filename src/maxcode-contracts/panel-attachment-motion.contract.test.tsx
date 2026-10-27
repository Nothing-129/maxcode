import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AttachmentTray } from "@/components/chat/composer/attachment-tray"
import { ComposerImageThumbnails } from "@/components/chat/composer/composer-image-thumbnails"
import type { ImageInputAttachment } from "@/components/chat/message-input-attachments"
import en from "@/i18n/messages/en.json"
import { source } from "./contract-source"

vi.mock("@/lib/copy-image", async (original) => ({
  ...(await original<typeof import("@/lib/copy-image")>()),
  canCopyImageToClipboard: () => false,
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const image = (id: string): ImageInputAttachment => ({
  id,
  type: "image",
  data: "QQ==",
  uri: null,
  name: `${id}.png`,
  mimeType: "image/png",
})

function Composer({
  attachments,
  onRemove = () => {},
}: {
  attachments: ImageInputAttachment[]
  onRemove?: (id: string) => void
}) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <AttachmentTray
        present={attachments.length > 0}
        className="relative flex"
      >
        <ComposerImageThumbnails
          attachments={attachments}
          onRemove={onRemove}
        />
      </AttachmentTray>
      <textarea aria-label="Draft" />
    </NextIntlClientProvider>
  )
}

describe("panel and attachment motion", () => {
  it("keeps remaining thumbnails, the draft and focus stable when one attachment is removed", async () => {
    const onRemove = vi.fn()
    const view = render(
      <Composer
        attachments={[image("one"), image("two")]}
        onRemove={onRemove}
      />
    )
    const draft = screen.getByRole("textbox", { name: "Draft" })
    fireEvent.change(draft, { target: { value: "Keep my draft" } })
    draft.focus()
    const remaining = view.container.querySelector(
      '[data-attachment-tile="two"]'
    )
    fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("one")
    view.rerender(<Composer attachments={[image("two")]} onRemove={onRemove} />)
    const exiting = view.container.querySelector('[data-attachment-tile="one"]')
    expect(exiting?.querySelector("[inert]")).not.toBeNull()
    expect(screen.queryByRole("button", { name: "Remove one.png" })).toBeNull()
    expect(view.container.querySelector('[data-attachment-tile="two"]')).toBe(
      remaining
    )
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    expect(draft).toHaveValue("Keep my draft")
    expect(draft).toHaveFocus()
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-attachment-tile="one"]')
      ).toBeNull()
    )
  })

  it("keeps the final card mounted for its exit while immediately disabling its controls", async () => {
    const view = render(<Composer attachments={[image("last")]} />)
    const tray = view.container.querySelector("[data-attachment-tray]")
    view.rerender(<Composer attachments={[]} />)
    expect(view.container.querySelector("[data-attachment-tray]")).toBe(tray)
    expect(tray).toHaveAttribute("inert")
    expect(tray).toHaveAttribute("aria-hidden", "true")
    expect(screen.queryByRole("button", { name: "Remove last.png" })).toBeNull()
    await waitFor(() =>
      expect(view.container.querySelector("[data-attachment-tile]")).toBeNull()
    )
    view.rerender(<Composer attachments={[image("next")]} />)
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove next.png" })
      ).toBeVisible()
    )
    expect(tray).not.toHaveAttribute("inert")
  })

  it("updates upload state without replacing the thumbnail or editor", () => {
    const attachment = image("upload")
    const view = render(
      <Composer attachments={[{ ...attachment, uploading: true }]} />
    )
    const tile = view.container.querySelector("[data-attachment-tile]")
    const img = screen.getByAltText("upload.png")
    view.rerender(
      <Composer attachments={[{ ...attachment, uploading: false }]} />
    )
    expect(view.container.querySelector("[data-attachment-tile]")).toBe(tile)
    expect(screen.getByAltText("upload.png")).toBe(img)
  })

  it("keeps panel geometry toggle-only and retains closing auxiliary content", () => {
    const layout = source("src/app/workspace/layout.tsx")
    expect(layout).toContain("<AuxPanel keepVisible={auxAnimating} />")
    expect(layout).toContain('data-panel-edge="right"')
    expect(layout).toContain('data-panel-edge="bottom"')
    expect(layout).toContain("inert={!auxOpen}")
    expect(layout).toContain("inert={!terminalOpen}")
    expect(layout).toContain("<TerminalPanel />")
    expect(source("src/components/layout/aux-panel.tsx")).toContain(
      "if (!isOpen && !keepVisible) return null"
    )
    const css = source("src/app/globals.css")
    expect(css).toContain(".panel-slide-animating > [data-panel]")
    expect(css).toContain("transition: flex-grow 240ms ease-out")
    expect(
      source("src/components/chat/composer/composer-image-thumbnails.tsx")
    ).toContain('layout={reduced ? false : "position"}')
    expect(source("src/app/interaction-motion.css")).toContain(
      "grid-template-rows: 0fr"
    )
    expect(
      source("src/components/chat/composer/attachment-tray.tsx")
    ).toContain('className="min-h-0 overflow-hidden"')
  })
})
