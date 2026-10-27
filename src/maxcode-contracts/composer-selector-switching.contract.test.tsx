import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { InlineSessionConfigSelector } from "@/components/chat/session-config-selector"
import { InlineModeSelector } from "@/components/chat/mode-selector"
import { ModelOptionPicker } from "@/components/chat/model-option-picker"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import en from "@/i18n/messages/en.json"
import type { SessionConfigOptionInfo } from "@/lib/types"
import { source } from "./contract-source"

vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100 }),
}))

afterEach(cleanup)

function option(
  id: string,
  name: string,
  value: string
): SessionConfigOptionInfo {
  return {
    id,
    name,
    description: `${name} settings`,
    category: null,
    kind: {
      type: "select",
      current_value: value,
      groups: [],
      options: [
        { value, name: value, description: null },
        { value: "alternative", name: "Alternative", description: null },
      ],
    },
  }
}

function Controls({
  onSelect = vi.fn(),
}: {
  onSelect?: (id: string, value: string) => void
}) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <InlineSessionConfigSelector
        option={option("access", "Access", "Full access")}
        onSelect={onSelect}
      />
      <InlineSessionConfigSelector
        option={option("reasoning", "Reasoning", "Medium")}
        onSelect={onSelect}
      />
      <InlineModeSelector
        label="Mode"
        selectedModeId="default"
        modes={[
          { id: "default", name: "Default", description: null },
          { id: "plan", name: "Plan", description: null },
        ]}
        onSelect={(value) => onSelect("mode", value)}
      />
      <ModelOptionPicker
        option={option("model", "Model", "Model A")}
        groups={[
          {
            key: "models",
            name: null,
            options: [
              { value: "Model A", name: "Model A", description: null },
              { value: "Model B", name: "Model B", description: null },
            ],
          },
        ]}
        onSelect={onSelect}
      />
      <button>Outside action</button>
    </NextIntlClientProvider>
  )
}

describe("composer selector handoff and motion", () => {
  it("opens the next menu on the first click, without blocking the control row", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Controls onSelect={onSelect} />)
    const access = screen.getByRole("button", { name: "Access: Full access" })
    const reasoning = screen.getByRole("button", { name: "Reasoning: Medium" })
    const mode = screen.getByRole("button", { name: "Mode: Default" })
    for (const button of [access, reasoning, mode, access]) {
      await user.click(button)
      expect(button).toHaveAttribute("aria-expanded", "true")
      expect(document.body.style.pointerEvents).not.toBe("none")
      expect(
        document.querySelectorAll(
          '[data-composer-selector-content][data-state="open"]'
        )
      ).toHaveLength(1)
    }
    expect(onSelect).not.toHaveBeenCalled()
    await user.click(screen.getByRole("menuitemradio", { name: "Alternative" }))
    expect(onSelect).toHaveBeenCalledWith("access", "alternative")
    expect(access).toHaveAttribute("aria-expanded", "false")
  })

  it("hands off both ways between dropdowns and the searchable model popover", async () => {
    const user = userEvent.setup()
    render(<Controls />)
    const access = screen.getByRole("button", { name: "Access: Full access" })
    const model = screen.getByRole("button", { name: "Model: Model A" })
    await user.click(access)
    await user.click(model)
    expect(model).toHaveAttribute("aria-expanded", "true")
    expect(access).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("combobox")).toHaveFocus()
    await user.click(access)
    expect(access).toHaveAttribute("aria-expanded", "true")
    expect(model).toHaveAttribute("aria-expanded", "false")
    expect(
      document.querySelectorAll(
        '[data-composer-selector-content][data-state="open"]'
      )
    ).toHaveLength(1)
  })

  it("toggles the same trigger and restores keyboard focus on Escape", async () => {
    const user = userEvent.setup()
    render(<Controls />)
    const button = screen.getByRole("button", { name: "Access: Full access" })
    await user.click(button)
    await user.click(button)
    expect(button).toHaveAttribute("aria-expanded", "false")
    button.focus()
    await user.keyboard("{Enter}")
    expect(button).toHaveAttribute("aria-expanded", "true")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(button).toHaveFocus())
    expect(button).toHaveAttribute("aria-expanded", "false")
  })

  it("keeps an enclosing dialog open during sibling selector handoffs", async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Settings</DialogTitle>
          <Controls />
        </DialogContent>
      </Dialog>
    )
    await user.click(
      screen.getByRole("button", { name: "Access: Full access" })
    )
    await user.click(screen.getByRole("button", { name: "Reasoning: Medium" }))
    expect(
      screen.getByRole("button", { name: "Reasoning: Medium" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible()
  })

  it("targets Radix state attributes and keeps a finite, non-interactive exit", () => {
    for (const path of [
      "src/components/ui/dropdown-menu.tsx",
      "src/components/ui/popover.tsx",
    ]) {
      const code = source(path)
      expect(code).toContain("data-[state=open]:animate-in")
      expect(code).toContain("data-[state=closed]:animate-out")
      expect(code).not.toContain("data-open:animate-in")
    }
    const css = source("src/app/interaction-motion.css")
    expect(css).toContain("animation: maxcode-selector-in 180ms")
    expect(css).toContain("animation: maxcode-selector-out 120ms")
    const closed = css.slice(
      css.indexOf('[data-composer-selector-content][data-state="closed"]'),
      css.indexOf('[data-slot="tooltip-content"]')
    )
    expect(closed).toContain("pointer-events: none")
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion"))
    expect(reduced).toContain("animation: maxcode-fade-in 120ms")
    expect(reduced).toContain("animation: maxcode-fade-out 100ms")
  })
})
