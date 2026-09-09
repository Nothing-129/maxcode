import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  MobileHeaderProvider,
  MobileHeaderSlot,
  MobileHeaderTarget,
} from "@/components/layout/mobile-header-slot"
import { source } from "./contract-source"

function MobileLayout({
  title,
  hidden = false,
}: {
  title: string
  hidden?: boolean
}) {
  return (
    <MobileHeaderProvider>
      <header data-testid="navigation">
        <MobileHeaderTarget hidden={hidden} />
      </header>
      <main data-testid="conversation">
        <MobileHeaderSlot>
          <span>{title}</span>
        </MobileHeaderSlot>
      </main>
    </MobileHeaderProvider>
  )
}

describe("mobile workspace header", () => {
  it("keeps one live conversation title in the navigation row", () => {
    const view = render(<MobileLayout title="First conversation" />)
    expect(screen.getByTestId("navigation")).toHaveTextContent(
      "First conversation"
    )
    expect(screen.getByTestId("conversation")).toBeEmptyDOMElement()
    view.rerender(<MobileLayout title="Next conversation" />)
    expect(screen.queryByText("First conversation")).not.toBeInTheDocument()
    expect(screen.getByTestId("navigation")).toHaveTextContent(
      "Next conversation"
    )
    view.rerender(<MobileLayout title="Next conversation" hidden />)
    expect(screen.getByText("Next conversation")).not.toBeVisible()
    view.rerender(<MobileLayout title="Next conversation" />)
    expect(screen.getByText("Next conversation")).toBeVisible()
  })

  it("preserves conversation actions and leaves desktop content in place", () => {
    const action = vi.fn()
    const view = render(
      <MobileHeaderProvider>
        <MobileHeaderTarget hidden={false} />
        <MobileHeaderSlot>
          <button onClick={action}>Rename</button>
        </MobileHeaderSlot>
      </MobileHeaderProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "Rename" }))
    expect(action).toHaveBeenCalledOnce()
    view.unmount()
    render(
      <main data-testid="desktop">
        <MobileHeaderSlot>Desktop title</MobileHeaderSlot>
      </main>
    )
    expect(screen.getByTestId("desktop")).toHaveTextContent("Desktop title")
  })

  it("provides a canvas-colored touch row and puts secondary tools in a menu", () => {
    const chrome = source("src/components/layout/folder-title-bar.tsx")
    expect(chrome).toContain("h-14")
    expect(chrome).toContain("bg-background")
    expect(chrome).not.toContain("bg-muted/70")
    expect(chrome).toContain("size-11 shrink-0 rounded-xl")
    expect(chrome).not.toContain('aria-label={tCard("newConversation")}')
    expect(chrome).toMatch(
      /<DropdownMenuItem\s+className="min-h-11"\s+onSelect=\{handleNewConversation\}\s*>[\s\S]*?tCard\("newConversation"\)[\s\S]*?<\/DropdownMenuItem>/
    )
    for (const label of [
      "search",
      "toggleTerminal",
      "toggleAuxPanel",
      "openSettings",
    ]) {
      expect(chrome).toMatch(
        new RegExp(
          `<DropdownMenuItem[\\s\\S]*?tTitleBar\\("${label}"\\)[\\s\\S]*?</DropdownMenuItem>`
        )
      )
    }
    expect(
      source("src/components/conversations/conversation-detail-header.tsx")
    ).toContain("<MobileHeaderSlot>{header}</MobileHeaderSlot>")
    expect(source("src/app/workspace/layout.tsx")).toContain(
      "<MobileHeaderProvider>"
    )
  })
})
