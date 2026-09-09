import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ScrollArea } from "@/components/ui/scroll-area"
import { OverlayScrollbarsInit } from "@/components/overlay-scrollbars-init"

const { area, initOptions, init } = vi.hoisted(() => ({
  area: vi.fn(),
  initOptions: vi.fn(),
  init: vi.fn(),
}))

vi.mock("overlayscrollbars-react", () => ({
  OverlayScrollbarsComponent: (props: { children: React.ReactNode }) => {
    area(props)
    return <div>{props.children}</div>
  },
  useOverlayScrollbars: (options: unknown) => {
    initOptions(options)
    return [init]
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("MaxCode contract: scroll-triggered overlay scrollbars", () => {
  const scrollbars = { autoHide: "scroll", autoHideDelay: 800 }

  it("hides shared scrollbars after scrolling stops without requiring pointer leave", () => {
    render(<ScrollArea>Conversations</ScrollArea>)
    expect(area).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          scrollbars: expect.objectContaining(scrollbars),
          overflow: { x: "hidden", y: "scroll" },
        }),
      })
    )
  })

  it("applies the same idle behavior to document scrollbars", () => {
    render(<OverlayScrollbarsInit />)
    expect(initOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          scrollbars: expect.objectContaining(scrollbars),
        }),
      })
    )
    expect(init).toHaveBeenCalledWith(document.body)
  })
})
