import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MessageResponse } from "@/components/ai-elements/message"
import { CodexFollowupContext } from "@/components/ai-elements/codex-followup"
import { source } from "./contract-source"

vi.mock("@/components/ai-elements/link-safety", () => ({
  useStreamdownLinkSafety: () => ({ enabled: false }),
}))

const directive =
  ':codex-followup[查看新增记录]{prompt="列出本次比上次新增的3条线索。 "}'

describe("Codex followup suggestions", () => {
  it("renders screenshot-style lists through the real Markdown pipeline and selects only on click", () => {
    const onSelect = vi.fn()
    const { container } = render(
      <CodexFollowupContext.Provider value={onSelect}>
        <MessageResponse>{`已导出 2,809 条。\n\n- ${directive}\n- :codex-followup[查看缺失记录]{prompt="列出合同号为空的线索。"}`}</MessageResponse>
      </CodexFollowupContext.Provider>
    )
    expect(container.textContent).toContain("已导出 2,809 条。")
    expect(container.textContent).not.toContain("codex-followup")
    expect(container.textContent).not.toContain("prompt=")
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "查看新增记录" }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith("列出本次比上次新增的3条线索。")
    expect(screen.getByRole("button", { name: "查看缺失记录" })).toBeVisible()
  })

  it("decodes escaped quotes and preserves Markdown and newlines in prompts", () => {
    const onSelect = vi.fn()
    const prompt = '查找 "a_b"，保留 **字段**\n路径 C:\\temp'
    render(
      <CodexFollowupContext.Provider value={onSelect}>
        <MessageResponse>{`::codex-followup[继续]{prompt=${JSON.stringify(prompt)}}`}</MessageResponse>
      </CodexFollowupContext.Provider>
    )
    fireEvent.click(screen.getByRole("button", { name: "继续" }))
    expect(onSelect).toHaveBeenCalledWith(prompt)
  })

  it.each([false, true])(
    "shows readable labels without controls on read-only surfaces (public=%s)",
    (publicMode) => {
      const { container } = render(
        <MessageResponse linkMode={publicMode ? "public" : "workspace"}>
          {directive}
        </MessageResponse>
      )
      expect(container.textContent).toBe("查看新增记录")
      expect(container.querySelector("button, a")).toBeNull()
    }
  )

  it("public shares never inherit a composer action", () => {
    const onSelect = vi.fn()
    const { container } = render(
      <CodexFollowupContext.Provider value={onSelect}>
        <MessageResponse linkMode="public">{directive}</MessageResponse>
      </CodexFollowupContext.Provider>
    )
    expect(container.querySelector("button, a")).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each([
    `\`${directive}\``,
    `\`\`\`text\n${directive}\n\`\`\``,
    `    ${directive}`,
    ':codex-followup[未完成]{prompt="还没',
    ':codex-followup[空内容]{prompt=""}',
  ])(
    "keeps code examples and malformed directives literal: %s",
    async (text) => {
      const { container } = render(
        <CodexFollowupContext.Provider value={vi.fn()}>
          <MessageResponse>{text}</MessageResponse>
        </CodexFollowupContext.Provider>
      )
      await waitFor(() =>
        expect(container.textContent).toContain("codex-followup")
      )
      expect(screen.queryByRole("button", { name: "查看新增记录" })).toBeNull()
    }
  )

  it("switches a streaming partial directive to a control when completed", () => {
    const onSelect = vi.fn()
    const view = (text: string) => (
      <CodexFollowupContext.Provider value={onSelect}>
        <MessageResponse mode="streaming" parseIncompleteMarkdown>
          {text}
        </MessageResponse>
      </CodexFollowupContext.Provider>
    )
    const { rerender } = render(
      view(':codex-followup[查看新增记录]{prompt="列出')
    )
    expect(screen.queryByRole("button", { name: "查看新增记录" })).toBeNull()
    rerender(view(directive))
    expect(screen.getByRole("button", { name: "查看新增记录" })).toBeVisible()
  })

  it("connects suggestion selection to append-only composer injection", () => {
    const panel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    expect(panel).toMatch(
      /handleFollowupSelection = useCallback\(\(prompt: string\) => \{\s*setComposerInject\(\{ text: prompt, mode: "append" \}\)/
    )
    expect(panel).toMatch(
      /composerAvailable \? handleFollowupSelection : undefined/
    )
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain('payload.mode === "append"')
    expect(input).toContain(
      "handle.insertTextAtCursor(`${gap}${payload.text}\\n\\n`)"
    )
  })
})
