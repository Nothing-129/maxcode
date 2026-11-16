import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import {
  SidebarNavigationProvider,
  useSidebarNavigation,
} from "@/contexts/sidebar-navigation-context"
import {
  WorkbenchRouteProvider,
  useWorkbenchRoute,
} from "@/contexts/workbench-route-context"

function Probe() {
  const navigation = useSidebarNavigation()!
  const route = useWorkbenchRoute()
  return (
    <>
      <output data-testid="location">
        {navigation.view}:{route.routeId}
      </output>
      <button onClick={() => navigation.setView("conversations")}>
        Conversations
      </button>
      <button onClick={() => route.setRoute("automations")}>Automations</button>
    </>
  )
}
function App() {
  return (
    <SidebarNavigationProvider>
      <WorkbenchRouteProvider>
        <Probe />
      </WorkbenchRouteProvider>
    </SidebarNavigationProvider>
  )
}
beforeEach(() => localStorage.clear())
it("restores the selected function after leaving and reentering", () => {
  const first = render(<App />)
  fireEvent.click(screen.getByText("Conversations"))
  first.unmount()
  const second = render(<App />)
  expect(screen.getByTestId("location")).toHaveTextContent(
    "conversations:conversations"
  )
  fireEvent.click(screen.getByText("Automations"))
  second.unmount()
  render(<App />)
  expect(screen.getByTestId("location")).toHaveTextContent(
    "conversations:automations"
  )
})
it("falls back safely when saved navigation is invalid", () => {
  localStorage.setItem("workspace:sidebar-view", "invalid")
  localStorage.setItem("workspace:workbench-route", "invalid")
  render(<App />)
  expect(screen.getByTestId("location")).toHaveTextContent("home:conversations")
})
