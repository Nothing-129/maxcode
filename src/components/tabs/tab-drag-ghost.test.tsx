import { describe, it, expect, afterEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { TabDragGhost } from "./tab-drag-ghost"
import { useTabStore } from "@/contexts/tab-context"

const dragTo = (overGroupId: string | null, x = 120, y = 64) =>
  act(() => {
    useTabStore.getState().updateTabDrag({
      tabId: "conv-1-codex-9",
      title: "Refactor the parser",
      x,
      y,
      overGroupId,
    })
  })

const release = () =>
  act(() => {
    useTabStore.getState().endTabDrag()
  })

describe("TabDragGhost", () => {
  afterEach(() => {
    release()
  })

  it("shows the floating chip only while hovering a FOREIGN group", () => {
    render(<TabDragGhost />)
    expect(screen.queryByText("Refactor the parser")).toBeNull()

    // Dragging over the tab's own strip: no chip (the real tab is visible).
    dragTo(null)
    expect(screen.queryByText("Refactor the parser")).toBeNull()

    dragTo("g-2")
    expect(screen.getByText("Refactor the parser")).toBeTruthy()

    dragTo(null)
    expect(screen.queryByText("Refactor the parser")).toBeNull()
  })

  it("shows a sidebar drag immediately, even before reaching a pane", () => {
    render(<TabDragGhost />)
    act(() =>
      useTabStore.getState().updateTabDrag({
        tabId: "sidebar-codex-9",
        title: "Folder conversation",
        source: "sidebar",
        x: 100,
        y: 200,
        overGroupId: null,
      })
    )
    expect(screen.getByText("Folder conversation")).toBeTruthy()
    release()
    expect(screen.queryByText("Folder conversation")).toBeNull()
  })

  it("leaves text-selection suppression to the dragged tab itself", () => {
    // The guard covers EVERY tab drag (within-group sorting, the unsplit strip),
    // not just the cross-group ones that produce a ghost — so it lives in
    // TabItem via drag-selection-guard, not here. See
    // src/lib/drag-selection-guard.test.ts.
    render(<TabDragGhost />)
    dragTo("g-2")
    expect(document.body.classList.contains("select-none")).toBe(false)
  })
})
