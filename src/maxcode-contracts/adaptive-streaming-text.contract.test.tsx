import { act, cleanup, render, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAdaptiveStreamingText } from "@/hooks/use-adaptive-streaming-text"
import { MessageResponse } from "@/components/ai-elements/message"
import { source } from "./contract-source"

vi.mock("@streamdown/code", () => ({
  code: { highlight: vi.fn(), supportsLanguage: () => false },
}))
vi.mock("@/contexts/workspace-context", () => ({
  useOptionalWorkspaceActions: () => null,
  useWorkspaceActions: () => ({}),
}))

let now = 100
let nextId = 0
const frames = new Map<number, FrameRequestCallback>()
function advance(ms: number) {
  for (let passed = 0; passed < ms; passed += 16) {
    now += 16
    const pending = [...frames.values()]
    frames.clear()
    act(() => pending.forEach((callback) => callback(now)))
  }
}

beforeEach(() => {
  now = 100
  frames.clear()
  vi.spyOn(performance, "now").mockImplementation(() => now)
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback)
    return nextId
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("adaptive assistant streaming", () => {
  it("buffers new text and accelerates large bursts without losing content", () => {
    const small = renderHook(
      ({ text }) => useAdaptiveStreamingText(text, true),
      {
        initialProps: { text: "" },
      }
    )
    const large = renderHook(
      ({ text }) => useAdaptiveStreamingText(text, true),
      {
        initialProps: { text: "" },
      }
    )
    small.rerender({ text: "字".repeat(20) })
    large.rerender({ text: "字".repeat(2000) })
    expect(large.result.current).toBe("")
    advance(160)
    expect(small.result.current.length).toBeGreaterThan(0)
    expect(large.result.current.length).toBeGreaterThan(
      small.result.current.length
    )
    expect(large.result.current.length).toBeLessThan(2000)
    advance(1600)
    expect(small.result.current).toBe("字".repeat(20))
    expect(large.result.current).toBe("字".repeat(2000))
  })

  it("keeps making progress when deltas arrive every frame", () => {
    const hook = renderHook(
      ({ text }) => useAdaptiveStreamingText(text, true),
      {
        initialProps: { text: "" },
      }
    )
    for (let i = 1; i <= 30; i++) {
      hook.rerender({ text: "文".repeat(i * 2) })
      advance(16)
    }
    expect(hook.result.current.length).toBeGreaterThan(10)
    advance(1500)
    expect(hook.result.current).toBe("文".repeat(60))
  })

  it("never reveals half an emoji or combining grapheme", () => {
    const units = ["👨‍👩‍👧‍👦", "é", "🇨🇳", "你好"]
    const text = units.join("")
    const boundaries = [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        text
      ),
    ].map(({ index, segment }) => text.slice(0, index + segment.length))
    const hook = renderHook(
      ({ text }) => useAdaptiveStreamingText(text, true),
      {
        initialProps: { text: "" },
      }
    )
    hook.rerender({ text })
    for (let i = 0; i < 30; i++) {
      advance(32)
      expect(["", ...boundaries]).toContain(hook.result.current)
    }
    expect(hook.result.current).toBe(text)
  })

  it("shows history, replacements and finished/stopped text immediately", () => {
    const hook = renderHook(
      ({ text, live }) => useAdaptiveStreamingText(text, live),
      { initialProps: { text: "已有正文", live: true } }
    )
    expect(hook.result.current).toBe("已有正文")
    hook.rerender({ text: "已有正文" + "新文字".repeat(100), live: true })
    advance(64)
    hook.rerender({ text: "替换内容", live: true })
    expect(hook.result.current).toBe("替换内容")
    hook.rerender({ text: "替换内容" + "结束".repeat(100), live: false })
    expect(hook.result.current).toBe("替换内容" + "结束".repeat(100))
    expect(frames.size).toBe(0)
  })

  it("flushes background queues and cancels frames on unmount", () => {
    const hook = renderHook(
      ({ text }) => useAdaptiveStreamingText(text, true),
      {
        initialProps: { text: "" },
      }
    )
    hook.rerender({ text: "后台文字".repeat(100) })
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(hook.result.current).toBe("后台文字".repeat(100))
    expect(frames.size).toBe(0)
    hook.rerender({ text: "后台文字".repeat(200) })
    hook.unmount()
    expect(frames.size).toBe(0)
  })

  it("uses the real Markdown character fade and leaves existing text settled", () => {
    const { container, rerender } = render(
      <MessageResponse mode="streaming" parseIncompleteMarkdown>
        {"已有文字"}
      </MessageResponse>
    )
    rerender(
      <MessageResponse mode="streaming" parseIncompleteMarkdown>
        {"已有文字新增文字"}
      </MessageResponse>
    )
    advance(64)
    const spans = [
      ...container.querySelectorAll<HTMLElement>("[data-sd-animate]"),
    ]
    expect(
      spans.some((s) => s.style.getPropertyValue("--sd-duration") === "350ms")
    ).toBe(true)
    expect(
      spans.some((s) => s.style.getPropertyValue("--sd-duration") === "0ms")
    ).toBe(true)
    rerender(<MessageResponse>{"已有文字新增文字"}</MessageResponse>)
    expect(container.textContent).toBe("已有文字新增文字")
    expect(container.querySelector("[data-sd-animate]")).toBeNull()
    expect(source("src/app/globals.css")).toContain(
      '@import "streamdown/styles.css"'
    )
    expect(source("src/app/globals.css")).toContain(
      '@import "./streaming-text.css"'
    )
    // A new delta must not shorten an older character's in-progress fade.
    expect(source("src/app/streaming-text.css")).toContain(
      "animation-duration: 350ms"
    )
  })

  it("bypasses typing and fade when reduced motion is requested", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList
    )
    const { container, rerender } = render(
      <MessageResponse mode="streaming">{"开头"}</MessageResponse>
    )
    rerender(
      <MessageResponse mode="streaming">{"开头新增文字"}</MessageResponse>
    )
    expect(container.textContent).toBe("开头新增文字")
    expect(container.querySelector("[data-sd-animate]")).toBeNull()
    expect(frames.size).toBe(0)
  })
})
