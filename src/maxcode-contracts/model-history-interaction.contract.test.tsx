import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { expect, it, vi } from "vitest"
import { InlineSessionConfigSelector } from "@/components/chat/session-config-selector"
import messages from "@/i18n/messages/zh-CN.json"

it("expands historical models without closing the menu and submits the original model id", async () => {
  const onSelect = vi.fn()
  const user = userEvent.setup()
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <InlineSessionConfigSelector
        option={{
          id: "model",
          name: "模型",
          description: null,
          category: "model",
          kind: {
            type: "select",
            current_value: "new",
            groups: [],
            options: [
              { value: "new", name: "Current", description: null },
              {
                value: "old",
                name: "Older",
                description: "Previous generation workhorse model.",
              },
            ],
          },
        }}
        onSelect={onSelect}
      />
    </NextIntlClientProvider>
  )
  await user.click(screen.getByRole("button"))
  expect(
    screen.queryByRole("menuitemradio", { name: /Older/ })
  ).not.toBeInTheDocument()
  const toggle = screen.getByRole("menuitem", { name: /历史模型/ })
  expect(toggle).toHaveAttribute("aria-expanded", "false")
  await user.click(toggle)
  expect(
    screen.getByRole("menuitem", { name: /收起历史模型/ })
  ).toHaveAttribute("aria-expanded", "true")
  await user.click(screen.getByRole("menuitemradio", { name: /Older/ }))
  expect(onSelect).toHaveBeenCalledWith("model", "old")
})
