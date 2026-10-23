import { useRef } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useSurfaceTransition } from "@/hooks/use-surface-transition"
import { source } from "./contract-source"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function PreservedSurface({ section }: { section: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useSurfaceTransition(ref, section)
  return (
    <div ref={ref} data-testid="surface">
      <input aria-label="Draft" defaultValue="" />
    </div>
  )
}

describe("MaxCode contract: consistent interface motion", () => {
  it.each(["220ms", ".22s"])(
    "preserves drafts/scroll and uses the actual %s duration",
    (duration) => {
      vi.spyOn(window, "getComputedStyle").mockReturnValue({
        getPropertyValue: (property: string) =>
          property === "--motion-enter" ? duration : "",
      } as CSSStyleDeclaration)
      const cancel = vi.fn()
      const animate = vi.fn(() => ({ cancel }))
      Object.defineProperty(HTMLElement.prototype, "animate", {
        configurable: true,
        value: animate,
      })
      try {
        const { rerender, unmount } = render(
          <PreservedSurface section="general" />
        )
        const surface = screen.getByTestId("surface")
        const draft = screen.getByRole("textbox")
        fireEvent.change(draft, { target: { value: "unfinished" } })
        surface.scrollTop = 120
        rerender(<PreservedSurface section="appearance" />)
        expect(screen.getByRole("textbox")).toBe(draft)
        expect(draft).toHaveValue("unfinished")
        expect(surface.scrollTop).toBe(120)
        expect(animate).toHaveBeenCalledTimes(2)
        expect(animate).toHaveBeenLastCalledWith(
          [{ opacity: 0.65 }, { opacity: 1 }],
          { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        )
        expect(cancel).toHaveBeenCalledTimes(1)
        rerender(<PreservedSurface section="appearance" />)
        expect(animate).toHaveBeenCalledTimes(2)
        unmount()
        expect(cancel).toHaveBeenCalledTimes(2)
      } finally {
        Reflect.deleteProperty(HTMLElement.prototype, "animate")
      }
    }
  )

  it("works when the browser has no Web Animations API", () => {
    const { rerender } = render(<PreservedSurface section="general" />)
    rerender(<PreservedSurface section="appearance" />)
    expect(screen.getByRole("textbox")).toBeVisible()
  })

  it("keeps reduced-motion feedback spatially still and exits finite", () => {
    const css = source("src/app/motion.css")
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion"))
    expect(reduced).toContain("animation-name: maxcode-fade-in")
    expect(reduced).toContain("animation-name: maxcode-fade-out")
    expect(reduced).toContain("scale: none")
    expect(reduced).toContain("translate: none")
    expect(css).not.toContain("transition-property: all")
    expect(css).not.toContain("forwards")
    expect(source("src/app/globals.css")).toContain('@import "./motion.css"')
  })

  it("animates navigation and tabs, keeping streaming collapsibles opt-in", () => {
    expect(source("src/components/settings/settings-shell.tsx")).toContain(
      "useSurfaceTransition(contentRef, normalizedPathname)"
    )
    expect(source("src/components/workbench/workbench-content.tsx")).toContain(
      "useSurfaceTransition(surfaceRef, routeId)"
    )
    expect(
      source("src/components/conversations/conversation-detail-panel.tsx")
    ).toContain('"h-full maxcode-surface-enter"')
    expect(source("src/app/workspace/layout.tsx")).toContain(
      '!hidden && "maxcode-surface-enter"'
    )
    expect(source("src/components/ui/collapsible.tsx")).toContain(
      "maxcode-collapsible"
    )
    expect(source("src/components/ui/instant-collapsible.tsx")).not.toContain(
      "maxcode-collapsible"
    )
  })
})
