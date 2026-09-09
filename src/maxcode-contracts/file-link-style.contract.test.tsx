import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ReferenceBadge } from "@/components/chat/composer/badges/reference-badge"
import { source } from "./contract-source"

const data = {
  refType: "file" as const,
  id: "/tmp/app.dmg",
  label: "打开新版安装包",
}

describe("transcript file link style", () => {
  it("inherits body size and weight with blue text and an outline file icon", () => {
    const { container, getByRole } = render(
      <ReferenceBadge data={data} appearance="file-link" />
    )
    expect(getByRole("img")).toHaveClass(
      "text-[1em]",
      "font-[inherit]",
      "text-[#2456a6]"
    )
    expect(container.querySelector("svg")).toHaveClass("lucide-file")
    expect(container.querySelector("svg")).toHaveAttribute(
      "stroke-width",
      "1.5"
    )
  })
  it("retains the compact composer badge", () => {
    const { container, getByRole } = render(<ReferenceBadge data={data} />)
    expect(getByRole("img")).toHaveClass("text-[0.85em]", "text-blue-700")
    expect(container.querySelector("svg")).toHaveClass("lucide-file-text")
  })
  it("applies the presentation to local paths and codeg file references", () => {
    expect(
      source("src/components/ai-elements/markdown-link.tsx").match(
        /data=\{fileData\} appearance="file-link"/g
      )
    ).toHaveLength(2)
  })
})
