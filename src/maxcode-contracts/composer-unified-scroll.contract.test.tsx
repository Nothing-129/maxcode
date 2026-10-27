import type { ReactNode } from "react"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ScrollArea } from "@/components/ui/scroll-area"
import { source } from "./contract-source"

const { area } = vi.hoisted(() => ({ area: vi.fn() }))
vi.mock("overlayscrollbars-react", () => ({
  OverlayScrollbarsComponent: (props: { children: ReactNode }) => {
    area(props)
    return <div>{props.children}</div>
  },
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("composer unified overlay scrollbar", () => {
  it("keeps a slim composer rail visible only on overflow while preserving shared defaults", () => {
    const view = render(<ScrollArea autoHide="never">Composer</ScrollArea>)
    expect(area).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          scrollbars: expect.objectContaining({
            visibility: "auto",
            autoHide: "never",
            autoHideDelay: 800,
            clickScroll: true,
          }),
          overflow: { x: "hidden", y: "scroll" },
        }),
      })
    )
    view.rerender(<ScrollArea>Other area</ScrollArea>)
    expect(area).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          scrollbars: expect.objectContaining({
            visibility: "auto",
            autoHide: "scroll",
          }),
        }),
      })
    )
  })

  it("puts attachments and the editor inside the same scrollport with no nested file scrollbar", () => {
    const composer = source("src/components/chat/composer/rich-composer.tsx")
    const scroll = composer.slice(
      composer.indexOf("<ScrollArea"),
      composer.indexOf("</ScrollArea>")
    )
    expect(scroll).toContain("{attachmentContent}")
    expect(scroll).toContain("<EditorFileAttachments")
    expect(scroll).toContain("<EditorContent")
    expect(scroll).toContain('autoHide="never"')
    expect(
      source("src/components/chat/composer/editor-file-attachments.tsx")
    ).not.toContain("overflow-y-auto")
    const css = source("src/app/globals.css")
    expect(css).toContain("--os-size: 4px")
    expect(css).toContain("--os-padding-axis: 12px")
    expect(css).toContain("border-radius: 1rem 1rem 0 0")
    expect(css).toContain(
      ".codeg-composer .codeg-composer-scroll {\n  overflow: clip;"
    )
    expect(css).toContain(
      ".codeg-composer-scroll .os-scrollbar-vertical:not(.os-scrollbar-rtl) {\n  right: 6px;"
    )
    expect(css).toContain("scrollbar-width: none")
    expect(css).toContain(
      ".codeg-composer-scroll [data-overlayscrollbars-viewport]::-webkit-scrollbar"
    )
  })
})
