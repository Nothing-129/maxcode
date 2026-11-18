import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, expect, it, vi } from "vitest"
import { ModelFastMode } from "@/components/chat/model-fast-mode"
import { SessionSelectorsPanel } from "@/components/chat/session-selectors-panel"
import { AgentOptionPicker } from "@/components/shared/agent-option-picker"
import en from "@/i18n/messages/en.json"
import type { SessionConfigOptionInfo } from "@/lib/types"

vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100 }),
}))

const fast: SessionConfigOptionInfo = {
  id: "fast",
  name: "Fast",
  description: "Use faster responses",
  kind: { type: "boolean", current_value: false },
}

function models(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    value: String(index),
    name: `Model ${index} with a very long custom name`,
    description:
      "A custom model with enough details to wrap onto several lines.",
  }))
}

afterEach(cleanup)

it.each([12, 100])(
  "keeps Fast available outside the model scroller with %i models",
  async (count) => {
    const user = userEvent.setup()
    const onFast = vi.fn()
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AgentOptionPicker
          option={{
            id: "model",
            name: "Model",
            category: "model",
            description: null,
            kind: {
              type: "select",
              current_value: "0",
              options: models(count),
              groups: [],
            },
          }}
          value="0"
          onChange={vi.fn()}
          footer={<ModelFastMode option={fast} onSelect={onFast} />}
        />
      </NextIntlClientProvider>
    )
    await user.click(screen.getByRole("button", { name: /^Model:/ }))
    const toggle = await screen.findByRole("switch", { name: "Fast" })
    expect(toggle.closest(".overflow-y-auto") === null).toBe(true)
    expect(toggle.closest("label")).toHaveClass("shrink-0")
    if (count === 12) {
      expect(
        screen
          .getByRole("menuitemradio", { name: /^Model 0/ })
          .closest(".overflow-y-auto")
      ).not.toBeNull()
    } else {
      expect(screen.getByRole("combobox")).toBeVisible()
    }
    await user.click(toggle)
    expect(onFast).toHaveBeenCalledWith("fast", "true")
  }
)

it("keeps Fast outside the scrollable detail list in the compact settings panel", () => {
  render(
    <SessionSelectorsPanel
      settingsLabel="Settings"
      settings={[
        {
          key: "model",
          title: "Model",
          currentValue: "0",
          currentLabel: "Model 0",
          groups: [{ key: "models", name: null, options: models(12) }],
          onSelect: vi.fn(),
          footer: <ModelFastMode option={fast} onSelect={vi.fn()} />,
        },
      ]}
    />
  )
  expect(
    screen.getByRole("switch", { name: "Fast" }).closest(".overflow-y-auto") ===
      null
  ).toBe(true)
  expect(
    screen
      .getByRole("button", { name: /Model 11 with a very long custom name/ })
      .closest(".overflow-y-auto")
  ).not.toBeNull()
})
