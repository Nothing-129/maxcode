import { readFileSync } from "node:fs"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { MessageListSkeleton } from "@/components/message/message-list-skeleton"

afterEach(cleanup)

it("reserves a responsive transcript column with a quiet accessible loading status", () => {
  const { container } = render(<MessageListSkeleton label="加载中…" />)
  const status = screen.getByRole("status")
  expect(status).toHaveAttribute("aria-busy", "true")
  expect(screen.getByText("加载中…")).toHaveClass("sr-only")
  const placeholders = container.querySelector('[aria-hidden="true"]')!
  expect(placeholders).toHaveClass("maxcode-chat-column", "mx-auto")
  expect(
    placeholders.querySelectorAll('[data-slot="skeleton"]').length
  ).toBeGreaterThan(0)
  for (const block of placeholders.querySelectorAll('[data-slot="skeleton"]')) {
    expect(block).toHaveClass("motion-reduce:animate-none")
  }
  expect(container.querySelector("button, input, svg")).toBeNull()
})

it("only replaces the empty initial load, preserving cached and live content during refresh", () => {
  const source = readFileSync(
    "src/components/message/message-list-view.tsx",
    "utf8"
  )
  expect(source).toContain(
    "const hasRenderableContent = threadItems.length > 0 || Boolean(liveMessage)"
  )
  expect(source).toMatch(
    /if \(detailLoading && !hasRenderableContent\) \{\s*return <MessageListSkeleton label=\{t\("loading"\)\} \/>/
  )
})
