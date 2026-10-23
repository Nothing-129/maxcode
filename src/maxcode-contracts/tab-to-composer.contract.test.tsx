import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useTabToComposer } from "@/hooks/use-tab-to-composer"

function Harness() {
  useTabToComposer()
  return (
    <>
      <button>Conversation</button>
      <input aria-label="Search" />
      <div className="codeg-composer">
        <div contentEditable suppressContentEditableWarning tabIndex={0} />
      </div>
    </>
  )
}

function setup() {
  const result = render(<Harness />)
  const composer = result.container.querySelector<HTMLElement>(
    '[contenteditable="true"]'
  )!
  vi.spyOn(composer, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 10,
    right: 210,
    bottom: 110,
    width: 200,
    height: 100,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  })
  return { ...result, composer }
}

function tab(target: Element = document.body, init = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
    ...init,
  })
  fireEvent(target, event)
  return event
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("MaxCode: Tab returns to a visible conversation composer", () => {
  it("focuses from a non-input control without scrolling", () => {
    const { composer, getByRole } = setup()
    const focus = vi.spyOn(composer, "focus")
    const button = getByRole("button")
    button.focus()
    expect(tab(button).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(composer)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it("focuses from the document body", () => {
    const { composer } = setup()
    expect(tab().defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(composer)
  })

  it("uses the viewport when the fixed workspace leaves the root height zero", () => {
    const { composer } = setup()
    const root = document.documentElement
    const previousStyle = root.getAttribute("style")
    root.style.overflowX = "hidden"
    root.style.overflowY = "hidden"
    composer.parentElement!.style.position = "fixed"
    try {
      expect(root.getBoundingClientRect().height).toBe(0)
      expect(tab().defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(composer)
    } finally {
      if (previousStyle === null) root.removeAttribute("style")
      else root.setAttribute("style", previousStyle)
    }
  })

  it("still protects a visible dialog in a zero-height document root", () => {
    const { composer } = setup()
    const root = document.documentElement
    const previousStyle = root.getAttribute("style")
    root.style.overflowX = "hidden"
    root.style.overflowY = "hidden"
    const { getByRole } = render(<div role="dialog" />)
    vi.spyOn(getByRole("dialog"), "getBoundingClientRect").mockReturnValue(
      composer.getBoundingClientRect()
    )
    try {
      expect(tab().defaultPrevented).toBe(false)
      expect(document.activeElement).not.toBe(composer)
    } finally {
      if (previousStyle === null) root.removeAttribute("style")
      else root.setAttribute("style", previousStyle)
    }
  })

  it("leaves existing input and composer keyboard behavior alone", () => {
    const { composer, getByRole } = setup()
    for (const element of [getByRole("textbox"), composer]) {
      element.focus()
      expect(tab(element).defaultPrevented).toBe(false)
      expect(document.activeElement).toBe(element)
    }
  })

  it.each([
    { shiftKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { isComposing: true },
    { repeat: true },
    { key: "Enter" },
  ])("preserves modified / non-Tab keys: %j", (init) => {
    setup()
    expect(tab(document.body, init).defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(document.body)
  })

  it.each(["hidden", "disabled", "offscreen", "clipped", "inert"])(
    "ignores a %s composer",
    (kind) => {
      const { composer } = setup()
      const wrapper = composer.parentElement!
      if (kind === "hidden") wrapper.style.display = "none"
      if (kind === "disabled") wrapper.dataset.disabled = "true"
      if (kind === "inert") wrapper.setAttribute("inert", "")
      if (kind === "offscreen") {
        vi.mocked(composer.getBoundingClientRect).mockReturnValue({
          ...composer.getBoundingClientRect(),
          top: -200,
          bottom: -100,
        })
      }
      if (kind === "clipped") {
        wrapper.style.overflowY = "hidden"
        // jsdom's default zero rectangle clips the editor completely.
      }
      expect(tab().defaultPrevented).toBe(false)
      expect(document.activeElement).not.toBe(composer)
    }
  )

  it.each(["dialog", "alertdialog", "menu", "listbox"])(
    "does not escape a visible %s",
    (role) => {
      const { composer } = setup()
      render(<div role={role} data-testid="overlay" />)
      const overlay = document.querySelector<HTMLElement>(`[role="${role}"]`)!
      vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue(
        composer.getBoundingClientRect()
      )
      expect(tab().defaultPrevented).toBe(false)
      expect(document.activeElement).not.toBe(composer)
    }
  )

  it("honors a key already consumed by another control", () => {
    setup()
    const consume = (event: KeyboardEvent) => event.preventDefault()
    document.addEventListener("keydown", consume)
    tab()
    document.removeEventListener("keydown", consume)
    expect(document.activeElement).toBe(document.body)
  })

  it("removes the listener on unmount", () => {
    const { unmount } = setup()
    const remove = vi.spyOn(window, "removeEventListener")
    unmount()
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function))
  })
})
