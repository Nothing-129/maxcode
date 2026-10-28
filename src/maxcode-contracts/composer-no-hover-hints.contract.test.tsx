import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { InlineModeSelector } from "@/components/chat/mode-selector"
import { source } from "./contract-source"

afterEach(cleanup)

it("keeps composer config controls free of hover hints", () => {
  for (const name of [
    "session-config-selector",
    "mode-selector",
    "model-option-picker",
  ]) {
    const code = source(`src/components/chat/${name}.tsx`)
    expect(code).not.toContain("SelectorTooltip")
    expect(code).toContain('data-selector-control=""')
    expect(code).toContain("aria-label=")
  }
})

it("still opens and changes mode after hovering the control", async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(
    <InlineModeSelector
      modes={[
        { id: "full", name: "Full access", description: "Approval preset" },
        { id: "default", name: "Default", description: null },
      ]}
      selectedModeId="full"
      label="Mode"
      onSelect={onSelect}
    />
  )
  const trigger = screen.getByRole("button", { name: "Mode: Full access" })
  expect(trigger).not.toHaveAttribute("title")
  await user.hover(trigger)
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  await user.click(trigger)
  await user.click(screen.getByRole("menuitemradio", { name: "Default" }))
  expect(onSelect).toHaveBeenCalledWith("default")
})
