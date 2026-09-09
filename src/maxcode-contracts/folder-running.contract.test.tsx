import { cleanup, render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it } from "vitest"
import { FolderRunningIndicator } from "@/components/conversations/folder-running-indicator"
import enMessages from "@/i18n/messages/en.json"
import { source } from "./contract-source"

afterEach(cleanup)

describe("collapsed folder running activity", () => {
  it("follows expansion and live running count without a visible number", () => {
    const tree = (expanded: boolean, runningCount: number) => (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <FolderRunningIndicator
          expanded={expanded}
          runningCount={runningCount}
        />
      </NextIntlClientProvider>
    )
    const { container, rerender, getByTitle } = render(tree(false, 3))
    expect(container.querySelector("[data-running-spinner]")).not.toBeNull()
    expect(getByTitle("3 sessions running")).toHaveClass("ml-auto")
    expect(getByTitle("3 sessions running").querySelector("span")).toHaveClass(
      "sr-only"
    )
    rerender(tree(true, 3))
    expect(container).toBeEmptyDOMElement()
    rerender(tree(false, 1))
    expect(container.querySelector("[data-running-spinner]")).not.toBeNull()
    rerender(tree(false, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it.each(["sidebar-conversation-list", "sidebar-folder-group-header"])(
    "connects %s to the shared collapsed activity indicator",
    (name) => {
      const content = source("src/components/conversations/" + name + ".tsx")
      expect(content).toMatch(
        /<FolderRunningIndicator\s+expanded={expanded}\s+runningCount={runningCount}/
      )
      expect(content).not.toContain("<span aria-hidden>{runningCount}</span>")
    }
  )
})
