import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

// The predicate under test is the DEVICE class, not the viewport: mock both
// device hooks per case and keep the real sidebar context out of it.
const device = vi.hoisted(() => ({ mobile: false, coarse: false }))
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => device.mobile,
}))
vi.mock("@/hooks/use-is-coarse-pointer", () => ({
  useIsCoarsePointer: () => device.coarse,
}))

import { useCollapseSidebarOnNavigate } from "./use-collapse-sidebar-on-navigate"

const close = vi.fn()
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({ isOpen: true, toggle: vi.fn(), close }),
}))

import { useSidebarContext } from "@/contexts/sidebar-context"

/** Exposes the hook's callback as a button so a test can fire it. */
function Probe() {
  const collapseSidebarOnNavigate = useCollapseSidebarOnNavigate()
  const { isOpen } = useSidebarContext()
  return (
    <>
      <button type="button" onClick={collapseSidebarOnNavigate}>
        navigate
      </button>
      <span data-testid="open">{isOpen ? "yes" : "no"}</span>
    </>
  )
}

describe("useCollapseSidebarOnNavigate", () => {
  it.each([
    ["a phone viewport (mobile shell drawer)", true, false],
    ["a coarse pointer in the desktop shell", false, true],
  ])("closes the sidebar on %s", (_label, mobile, coarse) => {
    device.mobile = mobile
    device.coarse = coarse
    close.mockClear()
    render(<Probe />)
    fireEvent.click(screen.getByText("navigate"))
    expect(close).toHaveBeenCalledOnce()
  })

  it("keeps the sidebar open on precise-pointer desktop layouts", () => {
    device.mobile = false
    device.coarse = false
    close.mockClear()
    render(<Probe />)
    fireEvent.click(screen.getByText("navigate"))
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByTestId("open").textContent).toBe("yes")
  })
})
