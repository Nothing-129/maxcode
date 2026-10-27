import { fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"

function tree(streaming: boolean, text = "Inspecting the implementation") {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Reasoning isStreaming={streaming}>
        <ReasoningTrigger />
        <ReasoningContent>{text}</ReasoningContent>
      </Reasoning>
    </NextIntlClientProvider>
  )
}

describe("MaxCode contract: compact thinking", () => {
  it("keeps the brain icon before the label during and after thinking", () => {
    const { rerender } = render(tree(true))
    const icon = () =>
      screen.getByRole("button").querySelector("svg:first-child")
    expect(screen.getByRole("button")).toHaveClass(
      "h-6",
      "px-2",
      "text-[0.6875rem]",
      "leading-4",
      "font-normal",
      "text-muted-foreground"
    )
    expect(icon()).toHaveClass("size-3", "opacity-60")
    expect(icon()).not.toHaveClass("mr-1")
    expect(icon()).toHaveClass("lucide-brain")
    expect(icon()).toHaveAttribute("aria-hidden", "true")
    rerender(tree(false))
    expect(icon()).toHaveClass("lucide-brain")
  })

  it("keeps live thinking collapsed across incoming text and completion", () => {
    const { rerender } = render(tree(true))
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Inspecting the implementation")).toBeNull()
    rerender(tree(true, "A much longer thought".repeat(200)))
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false")
    rerender(tree(false))
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  })

  it("lets the reader inspect a bounded scrollable panel and close it during streaming", () => {
    const { rerender } = render(tree(true))
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true")
    const contentId = screen.getByRole("button").getAttribute("aria-controls")!
    expect(document.getElementById(contentId)).toHaveClass(
      "max-h-64",
      "overflow-y-auto",
      "overscroll-contain"
    )
    expect(screen.getByText("Inspecting the implementation")).toBeVisible()
    fireEvent.click(screen.getByRole("button"))
    rerender(tree(true, "Next thought"))
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  })

  it("preserves an explicit expansion when thinking finishes", () => {
    const { rerender } = render(tree(true))
    fireEvent.click(screen.getByRole("button"))
    rerender(tree(false))
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Inspecting the implementation")).toBeVisible()
  })
})
