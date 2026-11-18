import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(path, "utf8")

describe("unified composer menu presentation", () => {
  it.each([
    "shared/folder-select",
    "chat/model-option-picker",
    "chat/session-config-selector",
    "chat/mode-selector",
  ])("shares the floating menu surface in %s", (component) => {
    expect(source(`src/components/${component}.tsx`)).toContain(
      "SELECTOR_MENU_SURFACE"
    )
  })
  it("places the virtual model check after the text, like the radio menus", () => {
    const list = source("src/components/chat/model-option-list.tsx")
    expect(list.search(/selected\s*\?\s*\(?\s*<Check/)).toBeGreaterThan(
      list.indexOf("<DropdownRadioItemContent")
    )
  })
})
