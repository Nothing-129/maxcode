import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, expect, it } from "vitest"
import {
  SidebarNavigationProvider,
  useSidebarNavigation,
} from "@/contexts/sidebar-navigation-context"
import { SidebarNavigationOrderControl } from "@/components/layout/sidebar-navigation-order-control"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import en from "@/i18n/messages/en.json"

function Harness() {
  const navigation = useSidebarNavigation()!
  return (
    <>
      <output data-testid="order">{navigation.order.join(",")}</output>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SidebarNavigationOrderControl />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarNavigationProvider>
        <Harness />
      </SidebarNavigationProvider>
    </NextIntlClientProvider>
  )
}
beforeEach(() => localStorage.clear())
afterEach(cleanup)

it("moves navigation entries without closing the menu and restores the saved order", () => {
  const first = mount()
  expect(screen.getByRole("button", { name: "Home — Move up" })).toBeDisabled()
  fireEvent.click(screen.getByRole("button", { name: "Home — Move down" }))
  expect(screen.getByTestId("order")).toHaveTextContent(
    "conversations,home,projects,tasks,automations"
  )
  expect(screen.getByRole("menu")).toBeVisible()
  first.unmount()
  mount()
  expect(screen.getByTestId("order")).toHaveTextContent(
    "conversations,home,projects,tasks,automations"
  )
})

it("normalizes stale saved entries without losing or duplicating navigation", () => {
  localStorage.setItem(
    "workspace:navigation-order",
    JSON.stringify(["tasks", "tasks", "removed"])
  )
  mount()
  expect(screen.getByTestId("order")).toHaveTextContent(
    "tasks,home,conversations,projects,automations"
  )
})

it("uses arrow buttons without offering Alt shortcuts", () => {
  mount()
  const row = screen.getAllByRole("menuitem")[0]
  fireEvent.keyDown(row, { key: "ArrowDown", altKey: true })
  expect(screen.getByTestId("order")).toHaveTextContent(
    "home,conversations,projects,tasks,automations"
  )
  expect(row).not.toHaveAttribute("aria-keyshortcuts")
  expect(screen.queryByText(/Alt\+↑|⌥↑/)).not.toBeInTheDocument()
})
