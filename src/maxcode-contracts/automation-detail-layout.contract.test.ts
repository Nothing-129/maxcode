import { expect, it } from "vitest"
import { source } from "./contract-source"

it("places run history before the closed configuration and prompt disclosures", () => {
  const detail = source(
    "src/components/automations/automations-page.tsx"
  ).split("function AutomationDetail(")[1]
  expect(detail).toMatch(
    /<RunHistory\b[\s\S]*?<DetailDisclosure\b[\s\S]*?<AutomationPrompt\b/
  )
  expect(detail).toContain('variant="outline"')
  expect(
    source("src/components/automations/automation-detail-disclosures.tsx")
  ).toContain("<details")
})

it("shows the enabled and paused sidebar groups with the active row identified", () => {
  const page = source("src/components/automations/automations-page.tsx")
  expect(page).toContain('t("groupEnabled")')
  expect(page).toContain("aria-expanded={expanded}")
  expect(page).toMatch(/<ul className="[^"]*\bps-2\b/)
  expect(page).toContain("aria-current={selected")
  expect(page).not.toContain("RUN_NODE_RING")
})
