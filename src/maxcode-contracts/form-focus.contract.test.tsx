import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { source } from "./contract-source"

describe("subtle form focus", () => {
  it("keeps fields keyboard accessible with a thin blue focus boundary", async () => {
    const user = userEvent.setup()
    render(
      <>
        <Input aria-label="Title" />
        <Textarea aria-label="Content" aria-invalid />
      </>
    )
    await user.tab()
    const title = screen.getByRole("textbox", { name: "Title" })
    expect(title).toHaveFocus()
    expect(title).toHaveClass(
      "focus-visible:border-[#216ae4]",
      "focus-visible:ring-0"
    )
    await user.type(title, "A todo")
    expect(title).toHaveValue("A todo")
    await user.tab()
    const content = screen.getByRole("textbox", { name: "Content" })
    expect(content).toHaveFocus()
    expect(content).toHaveAttribute("aria-invalid", "true")
    expect(content).toHaveClass("aria-invalid:border-destructive")
  })

  it("covers shared fields and settings without restoring a thick focus halo", () => {
    for (const file of [
      "ui/input",
      "ui/textarea",
      "ui/select",
      "ui/input-group",
      "ui/combobox",
      "settings/web-service-settings",
    ]) {
      const component = source(`src/components/${file}.tsx`)
      expect(component).toContain(":border-[#216ae4]")
      expect(component).not.toMatch(
        /(?:focus-visible|focus-within)\]?:ring-\[3px\]/
      )
      expect(component).not.toMatch(
        /(?:focus-visible|focus-within)\]?:ring-ring\/50/
      )
    }
    expect(source("src/app/globals.css")).toContain(
      "[data-settings-input-group]:focus-within {\n  border-color: #216ae4;"
    )
  })
  it("prevents thick focus rings from returning anywhere in the app", () => {
    function inspect(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) inspect(path)
        else if (path.endsWith(".tsx") && !path.includes(".test.")) {
          expect(source(path), path).not.toMatch(
            /[^\s"`]*focus[^\s"`]*:ring-(?:\[3px\]|3)(?=[\s"`])/
          )
        }
      }
    }
    inspect("src/components")
    inspect("src/app")
    const tabs = source("src/components/ui/tabs.tsx")
    expect(tabs).toContain("outline-none")
    expect(tabs).not.toContain("focus-visible:outline-1")
    for (const file of [
      "src/app/login/page.tsx",
      "src/components/canvas/add-node-menu.tsx",
      "src/components/canvas/nodes/region-node.tsx",
      "src/components/chat/question-dialog.tsx",
      "src/components/conversations/conversation-share-options.tsx",
    ]) {
      expect(source(file), file).toContain("focus-visible:border-[#216ae4]")
    }
    for (const file of [
      "src/components/conversations/search-command-dialog.tsx",
      "src/components/todos/todo-conversation-folder-dialog.tsx",
    ]) {
      expect(source(file), file).toContain("<FolderSelect")
    }
    const css = source("src/app/globals.css")
    expect(css).toContain(
      '[data-settings-surface] [data-slot="select-trigger"]:focus-visible {\n  border-color: #216ae4;'
    )
    expect(css).toContain(
      ".settings-search:focus-within {\n  outline: 1px solid #216ae4;"
    )
  })
})
