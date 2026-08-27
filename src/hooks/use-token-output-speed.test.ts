import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getTokenOutputSegment,
  useTokenOutputSpeed,
} from "./use-token-output-speed"
import type {
  LiveContentBlock,
  LiveMessage,
  ToolCallInfo,
} from "@/contexts/acp-connections-context"

function msg(blocks: LiveContentBlock[], id = "live-1"): LiveMessage {
  return { id, role: "assistant", content: blocks, startedAt: 0 }
}

function tool(
  id: string,
  rawInput: string | null,
  status = "pending"
): LiveContentBlock {
  const info: ToolCallInfo = {
    tool_call_id: id,
    title: "tool",
    kind: "tool",
    status,
    content: null,
    raw_input: rawInput,
    raw_output_chunks: [],
    raw_output_total_bytes: 0,
    locations: null,
    meta: null,
    images: [],
  }
  return { type: "tool_call", info }
}

let fakeNow = 0

function mount(message: LiveMessage) {
  return renderHook(
    ({ message }: { message: LiveMessage }) => useTokenOutputSpeed(message),
    { initialProps: { message } }
  )
}

function tick(ms = 300) {
  fakeNow += ms
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  fakeNow = 1000
  vi.useFakeTimers()
  vi.spyOn(performance, "now").mockImplementation(() => fakeNow)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("getTokenOutputSegment", () => {
  it("counts root text, thinking, and tool-call input", () => {
    const segment = getTokenOutputSegment(
      msg([
        { type: "thinking", text: "think" },
        { type: "text", text: "answer" },
        { type: "text", text: "child", parentToolUseId: "delegate-1" },
        tool("one", '{"path":"a.ts"}'),
        tool("two", '{"path":"b.ts"}'),
      ])
    )

    expect(segment.key).toBe("live-1:0")
    expect(segment.texts).toEqual([
      "think",
      "answer",
      '{"path":"a.ts"}',
      '{"path":"b.ts"}',
    ])
    expect(segment.active).toBe(true)
  })

  it("starts a fresh generation after a tool round-trip", () => {
    const segment = getTokenOutputSegment(
      msg([
        { type: "thinking", text: "old thinking" },
        tool("one", "{}", "completed"),
        { type: "text", text: "sub-agent", parentToolUseId: "one" },
        { type: "thinking", text: "new thinking" },
        { type: "text", text: "new answer" },
      ])
    )

    expect(segment.key).toBe("live-1:3")
    expect(segment.texts).toEqual(["new thinking", "new answer"])
    expect(segment.active).toBe(true)
  })

  it("marks a generation inactive while its trailing tool executes", () => {
    const segment = getTokenOutputSegment(
      msg([{ type: "text", text: "before" }, tool("one", "{}", "in_progress")])
    )
    expect(segment.active).toBe(false)
  })
})

describe("useTokenOutputSpeed", () => {
  it("uses pi-web's cumulative token rate", () => {
    const { result, rerender } = mount(
      msg([{ type: "text", text: "a".repeat(120) }])
    )

    tick() // First non-zero observation: 30 estimated tokens.
    expect(result.current).toBeNull()

    rerender({ message: msg([{ type: "text", text: "a".repeat(240) }]) })
    tick() // 300 ms is still inside the 500 ms warmup.
    expect(result.current).toBeNull()

    rerender({ message: msg([{ type: "text", text: "a".repeat(360) }]) })
    tick()
    // pi-web includes the first observed batch: 90 total tokens / 0.6 s.
    expect(result.current).toBeCloseTo(150)
  })

  it("counts CJK one-to-one and skips sub-agent output", () => {
    const child = {
      type: "text",
      text: "子".repeat(500),
      parentToolUseId: "pt-1",
    } as const
    const { result, rerender } = mount(
      msg([
        { type: "thinking", text: "思".repeat(20) },
        { type: "text", text: "答".repeat(20) },
        child,
      ])
    )
    tick()

    rerender({
      message: msg([
        { type: "thinking", text: "思".repeat(30) },
        { type: "text", text: "答".repeat(30) },
        child,
      ]),
    })
    tick()

    rerender({
      message: msg([
        { type: "thinking", text: "思".repeat(40) },
        { type: "text", text: "答".repeat(40) },
        child,
      ]),
    })
    tick()

    expect(result.current).toBeCloseTo(80 / 0.6)
  })

  it("keeps time-to-first-token out of the rate", () => {
    const { result, rerender } = mount(msg([]))
    for (let i = 0; i < 10; i++) tick()
    expect(result.current).toBeNull()

    rerender({ message: msg([{ type: "text", text: "字".repeat(60) }]) })
    tick()
    tick()
    tick()
    expect(result.current).toBeCloseTo(60 / 0.6)
  })

  it("includes generated tool-call arguments", () => {
    const { result, rerender } = mount(msg([tool("one", "a".repeat(120))]))
    tick()
    rerender({ message: msg([tool("one", "a".repeat(240))]) })
    tick()
    rerender({ message: msg([tool("one", "a".repeat(360))]) })
    tick()
    expect(result.current).toBeCloseTo(150)
  })

  it("hides TPS during tool execution and resets for the next generation", () => {
    const { result, rerender } = mount(
      msg([{ type: "text", text: "a".repeat(120) }])
    )
    tick()
    tick()
    tick()
    expect(result.current).toBeCloseTo(50)

    rerender({
      message: msg([
        { type: "text", text: "a".repeat(120) },
        tool("one", "{}", "in_progress"),
      ]),
    })
    tick()
    expect(result.current).toBeNull()

    rerender({
      message: msg([
        { type: "text", text: "a".repeat(120) },
        tool("one", "{}", "completed"),
        { type: "text", text: "新".repeat(30) },
      ]),
    })
    tick()
    tick()
    tick()
    expect(result.current).toBeCloseTo(30 / 0.6)
  })

  it("resets when hydration replaces the live message identity", () => {
    const { result, rerender } = mount(
      msg([{ type: "text", text: "a".repeat(400) }], "live-1")
    )
    tick()
    tick()
    tick()
    expect(result.current).not.toBeNull()

    rerender({
      message: msg([{ type: "text", text: "b".repeat(800) }], "live-2"),
    })
    tick()
    expect(result.current).toBeNull()
  })

  it("repaints on its own cadence, not on every delta", () => {
    const { result, rerender } = mount(
      msg([{ type: "text", text: "a".repeat(120) }])
    )
    tick()
    tick()
    tick()
    const previous = result.current

    rerender({ message: msg([{ type: "text", text: "a".repeat(4000) }]) })
    tick(200)
    expect(result.current).toBe(previous)

    tick(100)
    expect(result.current as number).toBeGreaterThan(previous as number)
  })
})
