import { beforeEach, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import {
  persistedSelectorPreview,
  useConversationSelectorPreview,
} from "@/hooks/use-conversation-selector-preview"
import type { SessionConfigOptionInfo } from "@/lib/types"

const storageKey = "codeg:conversation-selector-previews:v1"
const options = (model: string, effort: string): SessionConfigOptionInfo[] =>
  [
    ["model", model],
    ["reasoning_effort", effort],
  ].map(([id, value]) => ({
    id,
    name: id,
    kind: {
      type: "select",
      current_value: value,
      options: [{ value, name: value }],
      groups: [],
    },
  }))
const base = {
  agentType: "codex",
  workingDir: "/project",
  conversationId: 1,
  ready: true,
  configOptions: options("gpt-5.6", "high"),
}

beforeEach(() => localStorage.clear())

it("paints each reopened history's confirmed model and effort before connecting", () => {
  const first = renderHook(useConversationSelectorPreview, {
    initialProps: base,
  })
  first.unmount()
  const second = renderHook(useConversationSelectorPreview, {
    initialProps: {
      ...base,
      conversationId: 2,
      configOptions: options("gpt-6", "medium"),
    },
  })
  second.unmount()
  const reopened = renderHook(useConversationSelectorPreview, {
    initialProps: {
      ...base,
      ready: false,
      configOptions: options("wrong-global-default", "low"),
    },
  })
  expect(reopened.result.current).toEqual(base.configOptions)
  reopened.rerender({ ...base, ready: false, conversationId: 2 })
  expect(reopened.result.current).toEqual(options("gpt-6", "medium"))
  reopened.rerender({
    ...base,
    ready: true,
    configOptions: options("native-new-value", "low"),
  })
  expect(reopened.result.current).toEqual(options("native-new-value", "low"))
  reopened.rerender({ ...base, ready: false })
  expect(reopened.result.current).toEqual(options("native-new-value", "low"))
})

it("never caches unconfirmed initialization defaults or borrows another workspace/agent", () => {
  const hook = renderHook(useConversationSelectorPreview, {
    initialProps: { ...base, ready: false },
  })
  expect(hook.result.current).toBeNull()
  expect(localStorage.getItem(storageKey)).toBeNull()
  hook.rerender(base)
  hook.rerender({ ...base, ready: false, workingDir: "/other" })
  expect(hook.result.current).toBeNull()
  hook.rerender({ ...base, ready: false, agentType: "grok" })
  expect(hook.result.current).toBeNull()
})

it("bounds persisted previews and tolerates invalid stored data", () => {
  localStorage.setItem(storageKey, "broken")
  const hook = renderHook(useConversationSelectorPreview, {
    initialProps: base,
  })
  for (let conversationId = 2; conversationId <= 40; conversationId++) {
    hook.rerender({ ...base, conversationId })
  }
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toHaveLength(32)
  hook.rerender({ ...base, ready: false })
  expect(hook.result.current).toBeNull()
})

it("shows database model and effort on a cold client without a local preview", () => {
  const { result, rerender } = renderHook(useConversationSelectorPreview, {
    initialProps: {
      ...base,
      ready: false,
      persistedValues: { model: "gpt-5.6", reasoning_effort: "medium" },
    },
  })
  expect(result.current?.map((item) => item.kind.current_value)).toEqual([
    "gpt-5.6",
    "medium",
  ])
  // Switching to another conversation must use that row even with no catalog.
  rerender({
    ...base,
    ready: false,
    conversationId: 99,
    persistedValues: { model: "gpt-6", reasoning_effort: "high" },
  })
  expect(result.current?.map((item) => item.kind.current_value)).toEqual([
    "gpt-6",
    "high",
  ])
})

it("uses catalog labels without borrowing another conversation's values or permissions", () => {
  const catalog = options("gpt-6", "high")
  catalog.push({
    id: "permission",
    name: "Permission",
    kind: {
      type: "select",
      current_value: "full_access",
      options: [],
      groups: [],
    },
  })
  const preview = persistedSelectorPreview(
    { model: "gpt-5.6", reasoning_effort: "medium" },
    catalog
  )
  expect(preview?.map((item) => [item.id, item.kind.current_value])).toEqual([
    ["model", "gpt-5.6"],
    ["reasoning_effort", "medium"],
  ])
})
