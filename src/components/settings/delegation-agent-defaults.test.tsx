import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  AgentDelegationDefaults,
  AgentOptionsSnapshot,
  AgentType,
  SessionConfigSelectGroupInfo,
  SessionConfigSelectOptionInfo,
} from "@/lib/types"
import { MAINTAINED_AGENT_TYPES } from "@/lib/maintained-agents"

const describeAgentOptions = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({ describeAgentOptions }))

import { DelegationAgentDefaultsPanel } from "./delegation-agent-defaults"
import enMessages from "@/i18n/messages/en.json"

type Defaults = Partial<Record<AgentType, AgentDelegationDefaults>>
const choice = (value: string, name: string) => ({
  value,
  name,
  description: null,
})

function selectAnswer(
  id: string,
  category: string,
  currentValue: string,
  options: SessionConfigSelectOptionInfo[],
  groups: SessionConfigSelectGroupInfo[] = []
): AgentOptionsSnapshot {
  return {
    modes: null,
    config_options: [
      {
        id,
        name: id,
        description: null,
        category,
        kind: { type: "select", current_value: currentValue, options, groups },
      },
    ],
    available_commands: [],
  }
}

function panel(value: Defaults = {}, onChange = vi.fn()) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DelegationAgentDefaultsPanel value={value} onChange={onChange} />
    </NextIntlClientProvider>
  )
}

// The existing per-agent probe cache lasts 30 seconds. Move the clock forward
// between cases so each one exercises its own live probe.
let testNow = Date.now()
beforeEach(() => {
  testNow += 31_000
  vi.spyOn(Date, "now").mockReturnValue(testNow)
  describeAgentOptions.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe("delegation model defaults", () => {
  it("groups provider rows, strips repeated labels and saves the full model id", async () => {
    describeAgentOptions.mockResolvedValue(
      selectAnswer("model", "model", "chan-a/glm-5", [
        choice("chan-a/glm-5", "chan-a/glm-5"),
        choice("chan-a/glm-6", "chan-a/glm-6"),
        choice("chan-b/glm-5", "chan-b/glm-5"),
      ])
    )
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      panel(
        { claude_code: { config_values: { model: "chan-a/glm-5" } } },
        onChange
      )
    )

    await screen.findByText("Agent default: chan-a/glm-5")
    expect(screen.getByRole("combobox")).toHaveTextContent(/^glm-5$/)
    await user.click(screen.getByRole("combobox"))
    const list = await screen.findByRole("listbox")
    expect(within(list).getAllByText("glm-5")).toHaveLength(2)
    expect(within(list).queryByText("chan-a/glm-5")).toBeNull()
    await user.click(
      within(within(list).getByRole("group", { name: "chan-b" })).getByRole(
        "option",
        { name: "glm-5" }
      )
    )
    expect(onChange).toHaveBeenLastCalledWith({
      claude_code: { config_values: { model: "chan-b/glm-5" } },
    })
  })

  it.each([
    ["chan-b/glm-5", "chan-b/glm-5"],
    ["chan-a/glm-6", "glm-6"],
  ])("disambiguates only shared bare default names (%s)", async (id, label) => {
    describeAgentOptions.mockResolvedValue(
      selectAnswer("model", "model", id, [
        choice("chan-a/glm-5", "glm-5"),
        choice("chan-a/glm-6", "glm-6"),
        choice("chan-b/glm-5", "glm-5"),
      ])
    )
    render(panel())
    await screen.findByText(`Agent default: ${label}`)
  })

  it("preserves non-model lists and server-supplied group labels", async () => {
    const options = [choice("a/fast", "a/Fast"), choice("b/slow", "b/Slow")]
    describeAgentOptions.mockResolvedValue({
      ...selectAnswer("effort", "thought_level", "a/fast", options),
      config_options: [
        ...selectAnswer("effort", "thought_level", "a/fast", options)
          .config_options,
        ...selectAnswer("model", "model", "a/fast", options, [
          { group: "featured", name: "Featured", options: [options[0]] },
          { group: "others", name: "Others", options: [options[1]] },
        ]).config_options,
      ],
    })
    const user = userEvent.setup()
    render(panel())
    await screen.findAllByText("Agent default: a/Fast")
    const pickers = screen.getAllByRole("combobox")
    await user.click(pickers[0])
    let list = await screen.findByRole("listbox")
    expect(within(list).queryAllByRole("group")).toHaveLength(0)
    expect(within(list).getByRole("option", { name: "b/Slow" })).toBeVisible()
    await user.keyboard("{Escape}")
    await user.click(pickers[1])
    list = await screen.findByRole("listbox")
    expect(
      within(within(list).getByRole("group", { name: "Others" })).getByRole(
        "option",
        { name: "b/Slow" }
      )
    ).toBeVisible()
  })

  it("offers exactly the seven maintained delegation agents", () => {
    describeAgentOptions.mockResolvedValue({
      modes: null,
      config_options: [],
      available_commands: [],
    })
    render(panel())
    const buttons = screen.getAllByRole("tab")
    expect(buttons).toHaveLength(MAINTAINED_AGENT_TYPES.length)
    expect(buttons.map((button) => button.textContent)).toContain("ZCode")
    expect(screen.queryByRole("tab", { name: "OpenCode" })).toBeNull()
  })
})
