import { readFileSync } from "node:fs"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { FileLoadingSkeleton } from "@/components/files/file-loading-skeleton"
import { TodosLoadingSkeleton } from "@/components/todos/todos-loading-skeleton"

const source = (path: string) => readFileSync(`src/components/${path}`, "utf8")
afterEach(cleanup)

it.each(["code", "diff", "document", "list", "media"] as const)(
  "exposes a localized status and hides decorative %s file placeholders",
  (variant) => {
    const { container } = render(
      <FileLoadingSkeleton label="Loading file" variant={variant} />
    )
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("Loading file")).toHaveClass("sr-only")
    const decoration = container.querySelector('[aria-hidden="true"]')!
    expect(decoration.children).toHaveLength(variant === "diff" ? 2 : 1)
    expect(
      decoration.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    for (const block of decoration.querySelectorAll('[data-slot="skeleton"]')) {
      expect(block).toHaveClass("motion-reduce:animate-none")
    }
    expect(container.querySelector("button, input")).toBeNull()
  }
)

it.each(["board", "list"] as const)(
  "reserves the selected todo %s layout without interactive fake controls",
  (viewMode) => {
    const { container } = render(
      <TodosLoadingSkeleton label="Loading todos" viewMode={viewMode} />
    )
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("Loading todos")).toHaveClass("sr-only")
    const blocks = container.querySelectorAll('[data-slot="skeleton"]')
    expect(blocks.length).toBeGreaterThan(10)
    for (const block of blocks) {
      expect(block.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(block).toHaveClass("motion-reduce:animate-none")
    }
    expect(container.querySelector("button, input")).toBeNull()
  }
)

it("keeps existing transcript, file and todo content ahead of initial-loading placeholders", () => {
  expect(source("message/subagent-session-dialog.tsx")).toMatch(
    /loading && messages == null \? \(\s*<MessageListSkeleton/
  )
  expect(source("tasks/task-transcript-dialog.tsx")).toMatch(
    /if \(resolved == null\) \{\s*return <MessageListSkeleton/
  )
  expect(source("files/file-viewer-drawer.tsx")).toMatch(
    /if \(!tab \|\| \(tab.loading && tab.content === ""\)\) \{\s*return \(\s*<FileLoadingSkeleton/
  )
  const panel = source("files/file-workspace-panel.tsx")
  for (const gate of [
    "richDiffColdLoad",
    "sessionDiffColdLoad",
    "diffListColdLoad",
    "markdownColdLoad",
  ]) {
    expect(panel).toContain(
      `const ${gate} =\n      activeFileTab.loading && !hasTabContent(activeFileTab)`
    )
    expect(panel).toMatch(
      new RegExp(`\\{${gate} \\? \\(\\s*<FileLoadingSkeleton`)
    )
  }
  expect(panel).toContain(
    "hasTabContent(activeFileTab) || !activeFileTab.loading"
  )
  expect(source("todos/todos-page.tsx")).toMatch(
    /\{state \? \([\s\S]*?<TodosWorkspace[\s\S]*?\) : loading \? \(\s*<TodosLoadingSkeleton/
  )
})
