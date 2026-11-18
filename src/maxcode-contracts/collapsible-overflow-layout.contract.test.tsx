import { useLayoutEffect } from "react"
import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useCollapsibleOverflow } from "@/hooks/use-collapsible-overflow"

describe("collapsed transcript initial layout", () => {
  afterEach(() => vi.restoreAllMocks())

  it("measures clipping before ancestor layout consumers restore scroll", () => {
    let measured = false
    const measurementsAtLayout: boolean[] = []
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
      () => {
        measured = true
        return 1100
      }
    )
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(240)

    function Content() {
      const { contentRef, isOverflowing } =
        useCollapsibleOverflow<HTMLDivElement>("long transcript")
      return (
        <div>
          <div ref={contentRef}>Long message</div>
          {isOverflowing && <button>Show more</button>}
        </div>
      )
    }
    function Transcript() {
      useLayoutEffect(() => {
        measurementsAtLayout.push(measured)
      }, [])
      return <Content />
    }

    const view = render(<Transcript />)
    expect(measurementsAtLayout).toEqual([true])
    expect(view.getByRole("button", { name: "Show more" })).toBeVisible()
  })
})
