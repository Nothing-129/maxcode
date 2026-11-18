import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { expect, it, vi } from "vitest"
import {
  AgentConfigSection,
  effectiveSelections,
} from "@/components/automations/agent-config-section"
import messages from "@/i18n/messages/en.json"
import type { SessionConfigOptionInfo } from "@/lib/types"

vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100 }),
}))

function setup(
  options: SessionConfigOptionInfo[],
  layout: "inline" | "stacked" = "inline"
) {
  const onChange = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AgentConfigSection
        snapshot={{
          modes: null,
          available_commands: [],
          config_options: options,
        }}
        configValues={{}}
        modeId={null}
        loading={false}
        error={null}
        onReload={vi.fn()}
        layout={layout}
        onModeChange={vi.fn()}
        onConfigChange={onChange}
      />
    </NextIntlClientProvider>
  )
  return { user: userEvent.setup(), onChange }
}

const model: SessionConfigOptionInfo = {
  id: "model",
  name: "Model",
  category: "model",
  kind: {
    type: "select",
    current_value: "p/new",
    groups: [],
    options: [
      { value: "p/new", name: "p/New" },
      {
        value: "p/old",
        name: "p/Old",
        description: "Previous generation model.",
      },
    ],
  },
}

it("expands historical task models and saves the provider-qualified id", async () => {
  const { user, onChange } = setup([model])
  await user.click(screen.getByRole("button", { name: "Model: New" }))
  expect(screen.queryByRole("menuitemradio", { name: /Old/ })).toBeNull()
  await user.click(screen.getByRole("menuitem", { name: /Older models/ }))
  await user.click(screen.getByRole("menuitemradio", { name: /Old/ }))
  expect(onChange).toHaveBeenCalledWith("model", "p/old")
})

it("searches long model lists in task defaults and clears an override through inherit", async () => {
  const { user, onChange } = setup(
    [
      {
        ...model,
        kind: {
          type: "select",
          current_value: "p/0",
          groups: [],
          options: Array.from({ length: 30 }, (_, i) => ({
            value: `p/${i}`,
            name: `p/Model ${i}`,
          })),
        },
      },
    ],
    "stacked"
  )
  await user.click(screen.getByRole("button", { name: /Model:/ }))
  const search = screen.getByRole("combobox")
  await user.type(search, "p/28")
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenCalledWith("model", "p/28")
  await user.click(screen.getByRole("button", { name: /Model:/ }))
  await user.type(screen.getByRole("combobox"), messages.Automations.inherit)
  await user.keyboard("{Enter}")
  expect(onChange).toHaveBeenLastCalledWith("model", null)
})

it("puts the automation Fast switch inside the model menu and updates only its own option", async () => {
  const { user, onChange } = setup([
    model,
    {
      id: "fast_mode",
      name: "Fast",
      kind: { type: "boolean", current_value: false },
    },
  ])
  await user.click(screen.getByRole("button", { name: "Model: New" }))
  await user.click(screen.getByRole("switch", { name: "Fast" }))
  expect(onChange).toHaveBeenCalledWith("fast_mode", "true")
})

it("pins the displayed Fast state when saving a task and keeps a saved override", () => {
  const snapshot = {
    modes: null,
    available_commands: [],
    config_options: [
      model,
      {
        id: "fast_mode",
        name: "Fast",
        kind: { type: "boolean" as const, current_value: true },
      },
    ],
  }
  expect(effectiveSelections(snapshot, null, {}).config_values).toEqual({
    model: "p/new",
    fast_mode: "true",
  })
  expect(
    effectiveSelections(snapshot, null, { fast_mode: "false" }).config_values
      .fast_mode
  ).toBe("false")
})
