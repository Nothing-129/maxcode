import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FolderAliasLabel } from "./folder-alias-label"

describe("FolderAliasLabel", () => {
  it.each([
    ["My Project", "My Project"],
    ["  新名称  ", "新名称"],
    [null, "codeg"],
    ["   ", "codeg"],
  ])("shows the chosen display name for alias %s", (alias, expected) => {
    const { container } = render(
      <FolderAliasLabel name="codeg" alias={alias} />
    )
    expect(container.textContent).toBe(expected)
    expect(container.querySelector("span")).toBeNull()
  })
})
