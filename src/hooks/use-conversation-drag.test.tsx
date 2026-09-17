import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useConversationDrag } from "./use-conversation-drag"
import { useTabStore } from "@/stores/tab-store"

vi.mock("@/lib/conversation-drop-target", () => ({
  conversationDropTarget: () => ({ gid: "target", direction: "right" }),
}))

function Title() {
  return <span onPointerDown={useConversationDrag("tab", "Title")}>Title</span>
}

function pointer(type: string, x: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: 100,
  })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
  })
  return event
}

afterEach(() => {
  vi.restoreAllMocks()
  useTabStore.getState().endTabDrag()
})

describe("conversation title drag", () => {
  it("requires movement, previews an edge and commits once on release", () => {
    const drop = vi
      .spyOn(useTabStore.getState(), "dropTabInGroup")
      .mockImplementation(() => {})
    render(<Title />)
    fireEvent(screen.getByText("Title"), pointer("pointerdown", 100))
    fireEvent(window, pointer("pointermove", 102))
    expect(useTabStore.getState().tabDrag).toBeNull()
    fireEvent(window, pointer("pointermove", 200))
    expect(useTabStore.getState().tabDrag).toMatchObject({
      overGroupId: "target",
      direction: "right",
    })
    fireEvent(window, pointer("pointerup", 200))
    expect(drop).toHaveBeenCalledTimes(1)
    expect(drop).toHaveBeenCalledWith("tab", "target", "right")
    expect(useTabStore.getState().tabDrag).toBeNull()
    expect(document.body.classList.contains("select-none")).toBe(false)
  })

  it.each(["escape", "blur", "pointercancel", "unmount"])(
    "cancels on %s without changing the layout",
    (reason) => {
      const drop = vi
        .spyOn(useTabStore.getState(), "dropTabInGroup")
        .mockImplementation(() => {})
      const view = render(<Title />)
      fireEvent(screen.getByText("Title"), pointer("pointerdown", 100))
      fireEvent(window, pointer("pointermove", 200))
      act(() => {
        if (reason === "unmount") view.unmount()
        else if (reason === "escape")
          fireEvent.keyDown(window, { key: "Escape" })
        else fireEvent(window, new Event(reason))
      })
      fireEvent(window, pointer("pointerup", 200))
      expect(drop).not.toHaveBeenCalled()
      expect(useTabStore.getState().tabDrag).toBeNull()
      expect(document.body.classList.contains("select-none")).toBe(false)
    }
  )
})
