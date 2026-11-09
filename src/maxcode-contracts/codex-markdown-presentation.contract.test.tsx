import postcss from "postcss"
import { cleanup, render } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReferenceBadge } from "@/components/chat/composer/badges/reference-badge"
import { source } from "./contract-source"

vi.mock("@/components/ai-elements/link-safety", async (original) => ({
  ...(await original<typeof import("@/components/ai-elements/link-safety")>()),
  useStreamdownLinkSafety: () => ({ enabled: false }),
}))
vi.mock("@/components/message/file-reference-actions", () => ({
  FileReferenceActions: ({ children }: { children: React.ReactNode }) =>
    children,
}))

import { MessageResponse } from "@/components/ai-elements/message"

afterEach(cleanup)

const css = postcss.parse(source("src/app/globals.css"))
function declarations(selector: string) {
  const values: Record<string, string> = {}
  css.walkRules((rule) => {
    if (rule.selector.replace(/\s+/g, " ") !== selector) return
    rule.walkDecls((decl) => {
      values[decl.prop] = decl.value
    })
  })
  return values
}

describe("Codex reference Markdown presentation", () => {
  it("renders an unframed table with all existing controls and a scroll viewport", () => {
    const { container, getByRole } = render(
      <NextIntlClientProvider
        locale="zh-CN"
        messages={{ MarkdownTable: { plainText: "纯文本" } }}
      >
        <div className="chat-message-text">
          <MessageResponse>
            {
              "第一段。\n\n第二段。\n\n| 版本 | 字体 |\n| --- | --- |\n| 旧版 | Medium |\n| 新版 | Regular |\n\n最后一段。"
            }
          </MessageResponse>
        </div>
      </NextIntlClientProvider>
    )
    const wrapper = container.querySelector(
      '[data-streamdown="table-wrapper"]'
    )!
    expect(wrapper).not.toHaveClass("border", "bg-sidebar", "rounded-lg")
    const table = getByRole("table")
    expect(table.parentElement).toHaveClass("overflow-auto")
    expect(table.parentElement).not.toHaveClass("border", "bg-background")
    expect(table).not.toHaveClass("divide-y")
    expect(getByRole("button", { name: "Copy table" })).toBeInTheDocument()
    expect(getByRole("button", { name: "Download table" })).toBeInTheDocument()
    expect(getByRole("button", { name: "View fullscreen" })).toBeInTheDocument()
    expect(declarations('[data-streamdown="table-wrapper"]')).toMatchObject({
      border: "0",
      "background-color": "transparent",
      "margin-block": "1em",
    })
    expect(
      declarations(
        '[data-streamdown="table-header"], [data-streamdown="table-body"]'
      )["background-color"]
    ).toBe("transparent")
    expect(
      declarations('[data-streamdown="table-body"] > tr:not(:last-child)')[
        "border-bottom"
      ]
    ).toContain("7%")
  })

  it.each([
    "/tmp/shot.PNG",
    "C:\\images\\shot.webp",
    "/tmp/shot%2Epng",
    "/tmp/chart.svg",
  ])(
    "uses a decorative outline image icon inheriting the link color for %s",
    (path) => {
      const { container, getByRole } = render(
        <ReferenceBadge
          appearance="file-link"
          data={{
            refType: "file",
            id: path,
            label: "截图",
            uri: path,
            meta: null,
          }}
        />
      )
      const icon = container.querySelector('[data-file-icon="image-link"]')!
      expect(icon.tagName.toLowerCase()).toBe("svg")
      expect(icon).toHaveAttribute("stroke", "currentColor")
      expect(icon).toHaveAttribute("aria-hidden", "true")
      expect(icon).toHaveClass("size-[1.25em]", "inline-block")
      expect(icon.querySelector("rect")).not.toBeNull()
      expect(icon.querySelector("circle")).not.toBeNull()
      expect(getByRole("img", { name: "file: 截图" })).toHaveClass(
        "inline",
        "font-medium"
      )
      expect(container.querySelector("img")).toBeNull()
      expect(getByRole("img", { name: "file: 截图" })).toHaveTextContent("截图")
    }
  )

  it("shares link color across text and image links with a dark theme value", () => {
    expect(declarations(".chat-message-text")["--chat-link-color"]).toBe(
      "#2456a6"
    )
    expect(declarations(".dark .chat-message-text")["--chat-link-color"]).toBe(
      "#8ab4f8"
    )
    expect(
      declarations(
        '.chat-message-text [data-streamdown="link"], .chat-message-text [data-reference-badge][data-ref-type="file"]'
      )
    ).toMatchObject({
      color: "var(--chat-link-color)",
      "text-decoration": "none",
    })
  })

  it("keeps image links on the prose baseline without moving the text", () => {
    const { container } = render(
      <MessageResponse>
        {
          "字宽和行高没有变化。[旧版截图](/tmp/old.png) · [新版截图](/tmp/new.png)"
        }
      </MessageResponse>
    )
    const links = container.querySelectorAll('[data-resource-kind="file"]')
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveClass("inline", "align-baseline")
      expect(link.className).not.toContain("translate")
      expect(link.querySelector("[data-image-file-link]")).toHaveClass(
        "inline",
        "font-medium"
      )
    }
  })

  it("uses one-em paragraph gaps and no leading/trailing message gap", () => {
    expect(declarations(".chat-message-text .chat-markdown > p").margin).toBe(
      "1em 0"
    )
    expect(
      declarations(".chat-message-text .chat-markdown > :first-child")[
        "margin-top"
      ]
    ).toBe("0")
    expect(
      declarations(".chat-message-text .chat-markdown > :last-child")[
        "margin-bottom"
      ]
    ).toBe("0")
    expect(
      declarations('[data-streamdown="table-row"] > :first-child')[
        "padding-inline-start"
      ]
    ).toBe("0")
    expect(
      declarations('[data-streamdown="table-row"] > :last-child')[
        "padding-inline-end"
      ]
    ).toBe("0")
  })

  it("reserves a toolbar row above the scroll viewport at every screen width", () => {
    const { container, getByRole } = render(
      <NextIntlClientProvider
        locale="zh-CN"
        messages={{ MarkdownTable: { plainText: "纯文本" } }}
      >
        <MessageResponse>
          {
            "这段说明不能被工具栏遮挡。\n\n| 姓名 | 电话 |\n| --- | --- |\n| 示例 | 123 |"
          }
        </MessageResponse>
      </NextIntlClientProvider>
    )
    const wrapper = container.querySelector(
      '[data-streamdown="table-wrapper"]'
    )!
    const toolbar = getByRole("button", { name: "Copy table" }).parentElement!
    const viewport = getByRole("table").parentElement!
    expect(wrapper).toHaveClass("flex", "flex-col")
    expect(toolbar.parentElement).toBe(wrapper)
    expect(toolbar.nextElementSibling).toBe(viewport)
    expect(viewport).toHaveClass("overflow-auto")
    const selector =
      '[data-streamdown="table-wrapper"]:not([data-streamdown="table-fullscreen"] > *) > div:first-child:has(button)'
    const rules: postcss.Rule[] = []
    css.walkRules((rule) => {
      if (rule.selector.replace(/\s+/g, " ") === selector) rules.push(rule)
    })
    expect(rules).toHaveLength(1)
    expect(rules[0].parent?.type).toBe("root")
    expect(declarations(selector)).toMatchObject({
      position: "static",
      "align-self": "flex-end",
      "margin-bottom": "0.5em",
    })
  })
})
