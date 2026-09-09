import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FolderAliasLabel } from "@/components/conversations/folder-alias-label"
import { formatFolderLabelWithAlias } from "@/lib/folder-display"

describe("renamed folder labels", () => {
  it.each([
    ["  外呼中心  ", "外呼中心"],
    [null, "callcenter"],
    ["", "callcenter"],
    ["   ", "callcenter"],
  ])(
    "keeps UI and string labels consistent for alias %s",
    (alias, expected) => {
      const folder = Object.freeze({
        id: 7,
        name: "callcenter",
        alias,
        path: "/work/callcenter",
      })
      const { container } = render(
        <FolderAliasLabel name={folder.name} alias={folder.alias} />
      )
      expect(container.textContent).toBe(expected)
      expect(formatFolderLabelWithAlias(folder)).toBe(expected)
      expect(container.textContent).not.toContain("[")
      expect(folder.path).toBe("/work/callcenter")
      expect(folder.name).toBe("callcenter")
    }
  )
})
