import { beforeEach, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { isFastModeEnabled } from "@/components/chat/model-fast-mode"
import {
  persistedSelectorPreview,
  useConversationSelectorPreview,
} from "@/hooks/use-conversation-selector-preview"
import {
  applySavedConfigPreferences,
  getSavedPrefsForConnect,
  saveConfigPreference,
} from "@/lib/selector-prefs-storage"
import type { SessionConfigOptionInfo } from "@/lib/types"

beforeEach(() => localStorage.clear())

it("shows each conversation's own Fast state while switching and reconnecting", () => {
  const fast = (value: string): SessionConfigOptionInfo[] => [
    {
      id: "fast-mode",
      name: "Fast mode",
      kind: {
        type: "select",
        current_value: value,
        options: [
          { value: "on", name: "On" },
          { value: "off", name: "Off" },
        ],
        groups: [],
      },
    },
  ]
  const base = {
    agentType: "codex",
    workingDir: "/project",
    conversationId: 1,
    ready: true,
    configOptions: fast("off"),
  }
  const first = renderHook(useConversationSelectorPreview, {
    initialProps: base,
  })
  first.unmount()
  const second = renderHook(useConversationSelectorPreview, {
    initialProps: { ...base, conversationId: 2, configOptions: fast("on") },
  })
  second.unmount()

  const reopened = renderHook(useConversationSelectorPreview, {
    initialProps: { ...base, ready: false, configOptions: fast("on") },
  })
  expect(isFastModeEnabled(reopened.result.current?.[0])).toBe(false)
  reopened.rerender({ ...base, conversationId: 2, ready: false })
  expect(isFastModeEnabled(reopened.result.current?.[0])).toBe(true)
  reopened.rerender({ ...base, ready: true })
  expect(isFastModeEnabled(reopened.result.current?.[0])).toBe(false)
})

it("keeps Codex Fast as a new-session default but never sends it to an existing conversation", () => {
  saveConfigPreference("codex", "model", "gpt-6.1-terra")
  saveConfigPreference("codex", "fast-mode", "on")
  saveConfigPreference("codex", "fast_mode", "true")
  saveConfigPreference("codex", "approval_policy", "never")

  expect(getSavedPrefsForConnect("codex").configValues).toEqual({
    model: "gpt-6.1-terra",
    "fast-mode": "on",
    fast_mode: "true",
    approval_policy: "never",
  })
  expect(getSavedPrefsForConnect("codex", true).configValues).toEqual({
    approval_policy: "never",
  })

  // Re-reading during a slow reconnect must not replay another tab's edit.
  saveConfigPreference("codex", "fast-mode", "off")
  expect(getSavedPrefsForConnect("codex", true).configValues).toEqual({
    approval_policy: "never",
  })

  saveConfigPreference("claude_code", "fast-mode", "on")
  expect(getSavedPrefsForConnect("claude_code", true).configValues).toEqual({
    "fast-mode": "on",
  })
})

it("shows the saved Fast state from the conversation rather than the cached catalog", () => {
  const catalog: SessionConfigOptionInfo[] = [
    {
      id: "fast-mode",
      name: "Fast mode",
      kind: {
        type: "select",
        current_value: "on",
        options: [
          { value: "on", name: "On" },
          { value: "off", name: "Off" },
        ],
        groups: [],
      },
    },
  ]
  const old = persistedSelectorPreview({ "fast-mode": "off" }, catalog)
  const newer = persistedSelectorPreview({ "fast-mode": "on" }, catalog)
  expect(isFastModeEnabled(old?.[0])).toBe(false)
  expect(isFastModeEnabled(newer?.[0])).toBe(true)
  expect(
    isFastModeEnabled(
      persistedSelectorPreview({ "fast-mode": "true" }, null)?.[0]
    )
  ).toBe(true)

  saveConfigPreference("codex", "fast-mode", "on")
  expect(
    isFastModeEnabled(applySavedConfigPreferences("codex", catalog)?.[0])
  ).toBe(true)

  const booleanCatalog: SessionConfigOptionInfo[] = [
    {
      id: "fast-mode",
      name: "Fast mode",
      kind: { type: "boolean", current_value: false },
    },
  ]
  expect(
    isFastModeEnabled(applySavedConfigPreferences("codex", booleanCatalog)?.[0])
  ).toBe(true)
  saveConfigPreference("codex", "fast-mode", "true")
  const selectOff = [
    { ...catalog[0], kind: { ...catalog[0].kind, current_value: "off" } },
  ] as SessionConfigOptionInfo[]
  expect(
    isFastModeEnabled(applySavedConfigPreferences("codex", selectOff)?.[0])
  ).toBe(true)
})
