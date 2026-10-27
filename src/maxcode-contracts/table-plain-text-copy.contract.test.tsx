import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { Streamdown } from "streamdown"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  markdownTableComponents,
  tableDataToPlainText,
} from "@/components/ai-elements/markdown-table"
import { source } from "./contract-source"

const markdown = `| 日期 / 版本 | 主要变化 |
| --- | --- |
| **10/23** | 新增 \`/presets\`，支持 [链接](https://example.com) |
| 10/15 | 普通文本 |`

function renderTable(props = {}) {
  return render(
    <NextIntlClientProvider
      locale="zh-CN"
      messages={{ MarkdownTable: { plainText: "纯文本" } }}
    >
      <Streamdown mode="static" components={markdownTableComponents} {...props}>
        {markdown}
      </Streamdown>
    </NextIntlClientProvider>
  )
}

async function copyPlainText() {
  fireEvent.keyDown(
    screen.getAllByRole("button", { name: "Copy table" }).slice(-1)[0],
    {
      key: "Enter",
      ctrlKey: false,
      pointerType: "mouse",
    }
  )
  fireEvent.click(await screen.findByRole("menuitem", { name: "纯文本" }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("table plain text copy contract", () => {
  it("joins cells with spaces, preserves empty columns and flattens cell line breaks", () => {
    expect(
      tableDataToPlainText({
        headers: ["A", "B", "C"],
        rows: [
          ["one\ntwo", "", "end"],
          ["x", "y", "z"],
        ],
      })
    ).toBe("A   B   C\none two      end\nx   y   z")
  })

  it("copies rendered labels as plain text and retains the existing formats", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const write = vi.fn()
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText, write },
    })
    renderTable()
    await copyPlainText()
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "日期 / 版本   主要变化\n10/23   新增 /presets，支持 链接\n10/15   普通文本"
      )
    )
    expect(write).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole("button", { name: "Copy table" }), {
      key: "Enter",
      ctrlKey: false,
    })
    for (const name of ["Markdown", "CSV", "TSV"]) {
      expect(await screen.findByRole("menuitem", { name })).toBeInTheDocument()
    }
  })

  it("offers plain text in fullscreen too", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    renderTable()
    fireEvent.click(screen.getByRole("button", { name: "View fullscreen" }))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    await copyPlainText()
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
  })

  it("respects disabled controls and streaming state", () => {
    const view = renderTable({ controls: false })
    expect(screen.queryByRole("button", { name: "Copy table" })).toBeNull()
    view.unmount()
    renderTable({ isAnimating: true })
    expect(screen.getByRole("button", { name: "Copy table" })).toBeDisabled()
  })

  it("registers the same table renderer for replies and reasoning", () => {
    for (const file of ["message.tsx", "reasoning.tsx"]) {
      expect(source(`src/components/ai-elements/${file}`)).toContain(
        "...markdownTableComponents"
      )
    }
  })
})
