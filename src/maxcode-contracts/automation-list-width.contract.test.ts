import { expect, it } from "vitest"
import { source } from "./contract-source"

it("mounts the automation list in the resizable workspace sidebar", () => {
  const layout = source("src/app/workspace/layout.tsx")
  const panel = layout.slice(
    layout.indexOf("id={FOLDER_SHELL_LEFT_PANEL_ID}"),
    layout.indexOf("data-sidebar-seam")
  )
  expect(panel).toContain("ref={setAutomationSidebarHost}")
  expect(panel).toContain("sidebarSizeRange.minSize")
  expect(source("src/components/automations/automations-page.tsx")).toContain(
    "createPortal(listPane, sidebarHost)"
  )
})

it("keeps scheduling rules in detail and shows one short cue in each sidebar row", () => {
  const page = source("src/components/automations/automations-page.tsx")
  const row = page
    .split("function AutomationListItem(")[1]
    .split("function AutomationDetail(")[0]
  expect(row).not.toContain("<ScheduleLabel")
  expect(row).not.toContain('" · "')
  expect(page.split("function AutomationDetail(")[1]).toContain(
    "<ScheduleLabel"
  )
})
