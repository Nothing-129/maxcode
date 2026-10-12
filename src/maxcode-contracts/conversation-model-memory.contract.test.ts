import { beforeEach, expect, it, vi } from "vitest"
import { acpConnect } from "@/lib/api"
import { updateCachedSelectors } from "@/lib/selectors-cache-storage"
import {
  getSavedPrefsForConnect,
  saveConfigPreference,
} from "@/lib/selector-prefs-storage"

const call = vi.hoisted(() => vi.fn())
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ call }) }))

beforeEach(() => localStorage.removeItem("codeg:selector-prefs"))

it("uses recent model/thinking choices only for new conversations", () => {
  saveConfigPreference("codex", "model", "gpt-6.1-sol")
  saveConfigPreference("codex", "reasoning_effort", "high")
  expect(getSavedPrefsForConnect("codex").configValues).toEqual({
    model: "gpt-6.1-sol",
    reasoning_effort: "high",
  })
  expect(getSavedPrefsForConnect("codex", true).configValues).toBeNull()

  // Changes made in another tab while this history is connecting cannot
  // replace the conversation's model through the post-connect replay.
  saveConfigPreference("codex", "model", "gpt-5.6")
  saveConfigPreference("codex", "reasoning_effort", "medium")
  expect(getSavedPrefsForConnect("codex", true).configValues).toBeNull()
  expect(getSavedPrefsForConnect("codex").configValues?.model).toBe("gpt-5.6")
})

it("keeps unrelated selector defaults while restoring conversation models", () => {
  saveConfigPreference("zcode", "model", "old-model")
  saveConfigPreference("zcode", "thinking_level", "high")
  saveConfigPreference("zcode", "mode", "full_access")
  expect(getSavedPrefsForConnect("zcode", true).configValues).toEqual({
    mode: "full_access",
  })
})

it("recognizes adapter-specific model/thinking ids by their categories", () => {
  updateCachedSelectors("codex", {
    configOptions: [
      {
        id: "provider-model",
        name: "Model",
        category: "model",
        kind: { type: "select", current_value: "a", options: [], groups: [] },
      },
      {
        id: "provider-depth",
        name: "Thinking",
        category: "thought_level",
        kind: { type: "select", current_value: "b", options: [], groups: [] },
      },
    ],
  })
  saveConfigPreference("codex", "provider-model", "other-conversation-model")
  saveConfigPreference("codex", "provider-depth", "high")
  expect(getSavedPrefsForConnect("codex", true).configValues).toBeNull()
})

it("sends the conversation id so the backend restores that conversation", async () => {
  call.mockResolvedValueOnce("restored-connection")
  await expect(
    acpConnect("codex", "/tmp/chat", "old-session", null, null, 42)
  ).resolves.toBe("restored-connection")
  expect(call).toHaveBeenLastCalledWith("acp_connect", {
    agentType: "codex",
    workingDir: "/tmp/chat",
    sessionId: "old-session",
    preferredModeId: null,
    preferredConfigValues: null,
    conversationId: 42,
  })
})
