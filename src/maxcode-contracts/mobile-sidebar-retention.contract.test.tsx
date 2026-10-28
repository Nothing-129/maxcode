import { useEffect, useState } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { source } from "./contract-source"

afterEach(cleanup)

describe("mobile sidebar retention", () => {
  it("prepares closed content once and retains local state across reopening", async () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()
    function Content() {
      useEffect(() => {
        mounted()
        return unmounted
      }, [])
      return <input aria-label="Sidebar filter" defaultValue="" />
    }
    function Shell() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(!open)}>Toggle sidebar</button>
          <Drawer open={open} onOpenChange={setOpen} swipeDirection="left">
            <DrawerContent keepMounted showCloseButton={false}>
              <DrawerTitle>Sidebar</DrawerTitle>
              <Content />
            </DrawerContent>
          </Drawer>
        </>
      )
    }
    render(<Shell />)
    await waitFor(() => expect(mounted).toHaveBeenCalledOnce())
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
    fireEvent.click(screen.getByText("Toggle sidebar"))
    const filter = await screen.findByRole("textbox")
    fireEvent.change(filter, { target: { value: "Keep my filter" } })
    fireEvent.click(screen.getByText("Toggle sidebar"))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(unmounted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("Toggle sidebar"))
    expect(await screen.findByRole("textbox")).toBe(filter)
    expect(filter).toHaveValue("Keep my filter")
    expect(mounted).toHaveBeenCalledOnce()
  })

  it("retains both the mobile drawer and sidebar list while keeping restoration gating", () => {
    const layout = source("src/app/workspace/layout.tsx")
    const mobile = layout.slice(
      layout.indexOf("function MobileFolderWorkspaceShell("),
      layout.indexOf("function FolderWorkspaceShell(")
    )
    expect(mobile).toContain("open={sidebarRestored && sidebarOpen}")
    expect(mobile).toMatch(/<DrawerContent\s+keepMounted/)
    expect(mobile).toContain("<Sidebar keepVisible />")
  })
})
