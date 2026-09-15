import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MarkdownLink } from "@/components/ai-elements/markdown-link"

vi.mock("@/components/ai-elements/link-safety", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/ai-elements/link-safety")
  >()),
  useStreamdownLinkSafety: () => ({ enabled: true }),
}))

describe("Markdown link cursor contract", () => {
  it.each([
    "https://example.com/docs",
    "mailto:hello@example.com",
    "tel:+15550100",
  ])("shows a pointer for the clickable link %s", (href) => {
    render(<MarkdownLink href={href}>开发者说明</MarkdownLink>)
    expect(screen.getByRole("button")).toHaveClass("cursor-pointer")
  })

  it("does not suggest an incomplete streaming link is clickable", () => {
    render(
      <MarkdownLink href="streamdown:incomplete-link">开发者说明</MarkdownLink>
    )
    expect(screen.getByRole("button")).not.toHaveClass("cursor-pointer")
  })
})
