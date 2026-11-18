import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Command, CommandList } from "@/components/ui/command"
import { FolderOptionItem } from "@/components/shared/folder-select"

describe("compact composer project rows", () => {
  it("shows a single display name and retains the path as a hint", () => {
    render(
      <Command>
        <CommandList>
          <FolderOptionItem
            folder={{
              id: 1,
              name: "law-total",
              alias: "律总管",
              path: "/work/law-total",
            }}
            selected
            onSelect={vi.fn()}
          />
        </CommandList>
      </Command>
    )
    const row = screen.getByRole("option")
    expect(row).toHaveTextContent("律总管")
    expect(row).not.toHaveTextContent("/work/law-total")
    expect(row).toHaveAttribute("title", "/work/law-total")
    expect(row).toHaveAttribute("data-current", "true")
    expect(row.querySelector(".lucide-check")).not.toBeNull()
  })
})
