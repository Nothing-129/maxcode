import { readFileSync } from "node:fs"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { NextIntlClientProvider } from "next-intl"
import { Skeleton } from "@/components/ui/skeleton"
import { GeneratedImagesBlock } from "@/components/message/generated-images-block"
import messages from "@/i18n/messages/en.json"

afterEach(cleanup)

it("animates pending image generation but removes loading feedback on failure", () => {
  const card = (status: "in_progress" | "failed") => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <GeneratedImagesBlock revisedPrompt={null} image={null} status={status} />
    </NextIntlClientProvider>
  )
  const view = render(card("in_progress"))
  expect(screen.getByRole("status")).toHaveClass("maxcode-skeleton")
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  expect(screen.getByText("Generating image…")).toBeVisible()
  view.rerender(card("failed"))
  expect(screen.getByRole("status")).not.toHaveClass("maxcode-skeleton")
  expect(screen.getByRole("status")).not.toHaveAttribute("aria-busy")
})

it("gives shared loading placeholders a moving highlight without pulsing their content", () => {
  render(<Skeleton data-testid="placeholder" className="h-4 w-32 rounded-sm" />)
  const placeholder = screen.getByTestId("placeholder")
  expect(placeholder).toHaveAttribute("data-slot", "skeleton")
  expect(placeholder).toHaveClass(
    "maxcode-skeleton",
    "h-4",
    "w-32",
    "rounded-sm"
  )
  expect(placeholder).not.toHaveClass("animate-pulse")
})

it("uses theme colors, stops travel for reduced motion and pauses hidden placeholders", () => {
  const css = readFileSync("src/app/interaction-motion.css", "utf8")
  expect(css).toMatch(
    /\.maxcode-skeleton::before\s*\{[^}]*pointer-events: none;[^}]*var\(--foreground\)[^}]*animation: maxcode-skeleton-shine/
  )
  expect(css).toMatch(
    /\.conversation-tab-hidden \.maxcode-skeleton::before,\s*\[hidden\] \.maxcode-skeleton::before\s*\{\s*animation-play-state: paused;/
  )
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.maxcode-skeleton::before\s*\{\s*animation: none;\s*content: none;/
  )
})
