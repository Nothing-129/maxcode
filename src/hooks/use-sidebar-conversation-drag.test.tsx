import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DbConversationSummary } from "@/lib/types"
import { useSidebarConversationDrag } from "./use-sidebar-conversation-drag"
import { useTabStore } from "@/stores/tab-store"

vi.mock("@/lib/conversation-drop-target", () => ({
  sidebarConversationDropTarget: (x: number) =>
    x > 500 ? { gid: "target", direction: "right" } : null,
}))
const conversation = {
  id: 42,
  folder_id: 3,
  agent_type: "codex",
  title: "Folder session",
} as DbConversationSummary
function Row({ onSelect }: { onSelect: ReturnType<typeof vi.fn> }) {
  const down = useSidebarConversationDrag(onSelect)
  return (
    <button
      onPointerDown={(e) => down(e, conversation)}
      onClick={() => onSelect("click")}
    >
      Session
    </button>
  )
}
function pointer(type: string, x: number, pointerType = "mouse") {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: 100,
  })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
  })
  return event
}
afterEach(() => {
  vi.restoreAllMocks()
  useTabStore.getState().endTabDrag()
  // Consume any click guard installed by cancellation in this test.
  window.dispatchEvent(new MouseEvent("click", { detail: 1 }))
})

describe("sidebar conversation dragging", () => {
  it("does not select on press or preview, opens the dropped session once on release", () => {
    const select = vi.fn()
    const open = vi
      .spyOn(useTabStore.getState(), "openConversationInGroup")
      .mockImplementation(() => {})
    render(<Row onSelect={select} />)
    const row = screen.getByText("Session")
    fireEvent(row, pointer("pointerdown", 100))
    expect(select).not.toHaveBeenCalled()
    fireEvent(window, pointer("pointermove", 800))
    expect(useTabStore.getState().tabDrag).toMatchObject({
      title: "Folder session",
      overGroupId: "target",
    })
    expect(open).not.toHaveBeenCalled()
    fireEvent(window, pointer("pointerup", 800))
    fireEvent.click(row, { detail: 1 })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(conversation, "target", "right")
    expect(select).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabDrag).toBeNull()
  })

  it("keeps ordinary clicks working without duplicate selection", () => {
    const select = vi.fn()
    render(<Row onSelect={select} />)
    const row = screen.getByText("Session")
    fireEvent(row, pointer("pointerdown", 100))
    fireEvent(window, pointer("pointerup", 101))
    fireEvent.click(row, { detail: 1 })
    expect(select).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledWith(42, "codex", 3)
  })

  it.each(["outside", "escape", "pointercancel", "blur", "unmount"])(
    "does not open or select anything when canceled via %s",
    (reason) => {
      const select = vi.fn()
      const open = vi
        .spyOn(useTabStore.getState(), "openConversationInGroup")
        .mockImplementation(() => {})
      const view = render(<Row onSelect={select} />)
      fireEvent(screen.getByText("Session"), pointer("pointerdown", 100))
      fireEvent(window, pointer("pointermove", 800))
      if (reason === "outside") fireEvent(window, pointer("pointerup", 300))
      else if (reason === "escape") fireEvent.keyDown(window, { key: "Escape" })
      else if (reason === "unmount") view.unmount()
      else fireEvent(window, new Event(reason))
      fireEvent(window, pointer("pointerup", 800))
      expect(open).not.toHaveBeenCalled()
      expect(select).not.toHaveBeenCalled()
      expect(useTabStore.getState().tabDrag).toBeNull()
      expect(document.body.classList.contains("select-none")).toBe(false)
    }
  )
})
