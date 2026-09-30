import { useEffect } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AcpConnectionsProvider,
  useAcpActions,
  useConnectionStore,
} from "@/contexts/acp-connections-context"
import { WebEventStream } from "@/lib/transport/web-event-stream"
import type { LiveSessionSnapshot } from "@/lib/types"

// Keep the transport, snapshot conversion and provider real: a handler can
// commit the connection state before its runtime mirror fails. Transport-only
// mocks would miss the equal-seq guard that used to block that mirror's repair.
const h = vi.hoisted(() => ({
  actions: null as ReturnType<typeof useAcpActions> | null,
  store: null as ReturnType<typeof useConnectionStore> | null,
  stream: null as WebEventStream | null,
  sent: [] as Array<{
    action: string
    subscription_id: string
    since_seq?: number
  }>,
}))

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/contexts/alert-context", () => ({
  useAlertContext: () => ({ pushAlert: vi.fn() }),
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: { path: "/work", name: "work" } }),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async () => () => {}),
  getEventStream: () => h.stream,
}))
vi.mock("@/lib/desktop-notification", () => ({
  notifyDesktop: vi.fn(),
  withDesktopNotificationsSuppressed: (body: () => unknown) => body(),
}))
vi.mock("@/lib/notification-sound", () => ({
  playEventSound: vi.fn(),
  primeNotificationSoundOutput: vi.fn(),
  withEventSoundsSuppressed: (body: () => unknown) => body(),
}))
vi.mock("@/lib/selector-prefs-storage", () => ({
  getSavedPrefsForConnect: () => ({ modeId: null, configValues: null }),
  saveModePreference: vi.fn(),
  saveConfigPreference: vi.fn(),
}))
vi.mock("@/lib/api", () => ({
  acpGetAgentStatus: vi.fn(async () => ({
    agent_type: "claude_code",
    enabled: true,
    available: true,
    installed_version: "1.0.0",
    host_tools_agent_mode: false,
    is_acp_adapter: true,
  })),
  acpFindConnectionForConversation: vi.fn(async () => null),
  acpConnect: vi.fn(async () => "connection"),
  acpDisconnect: vi.fn(async () => {}),
  acpGetSessionSnapshot: vi.fn(async () => null),
  acpPrompt: vi.fn(),
  acpSetMode: vi.fn(),
  acpSetConfigOption: vi.fn(),
  acpCancel: vi.fn(),
  acpRespondPermission: vi.fn(),
  acpProbeConnection: vi.fn(async () => true),
  acpTouchConnection: vi.fn(async () => true),
  getFolderConversation: vi.fn(),
}))

const KEY = "conversation"

function Probe() {
  const actions = useAcpActions()
  const store = useConnectionStore()
  useEffect(() => {
    h.actions = actions
    h.store = store
  }, [actions, store])
  return null
}

function snapshot(seq: number, text: string): LiveSessionSnapshot {
  return {
    connection_id: "connection",
    conversation_id: null,
    folder_id: null,
    status: "prompting",
    external_id: "session",
    live_message: {
      id: "reply",
      role: "assistant",
      content: [{ kind: "text", text }],
      started_at: "2026-09-26T00:00:00Z",
    },
    active_tool_calls: [],
    pending_permission: null,
    modes: null,
    current_mode: null,
    config_options: null,
    prompt_capabilities: null,
    usage: null,
    fork_supported: false,
    available_commands: [],
    selectors_ready: true,
    event_seq: seq,
  }
}

function latestAttach() {
  const frames = h.sent.filter((item) => item.action === "attach")
  const frame = frames[frames.length - 1]
  if (!frame) throw new Error("expected an attach request")
  return frame
}

function deliver(snapshot: LiveSessionSnapshot) {
  act(() => {
    h.stream!.handleServerFrame({
      type: "snapshot",
      subscription_id: latestAttach().subscription_id,
      connection_id: snapshot.connection_id,
      event_seq: snapshot.event_seq,
      snapshot,
    })
  })
}

function liveText() {
  return h
    .store!.getConnection(KEY)
    ?.liveMessage?.content.map((block) =>
      block.type === "text" ? block.text : ""
    )
    .join("")
}

beforeEach(async () => {
  vi.useFakeTimers()
  h.sent = []
  h.stream = new WebEventStream({
    isWsOpen: () => true,
    sendFrame: (frame) => {
      h.sent.push(frame as (typeof h.sent)[number])
      return true
    },
    onWsReady: () => () => {},
  })
  render(
    <AcpConnectionsProvider>
      <Probe />
    </AcpConnectionsProvider>
  )
  await act(async () => {
    await h.actions!.connect(KEY, "claude_code", "/work")
  })
})

afterEach(() => {
  cleanup()
  h.stream?.destroy()
  h.stream = null
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("MaxCode contract: provider recovery after a stream handler fails", () => {
  it("repairs a failed runtime mirror when the recovery snapshot has the same seq", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const sink = vi.fn().mockImplementationOnce(() => {
      throw new Error("runtime mirror failed")
    })
    h.actions!.registerLiveMessageSink(KEY, sink)
    const initialId = latestAttach().subscription_id

    deliver(snapshot(5, "complete reply"))
    expect(error).toHaveBeenCalled()
    expect(h.store!.getConnection(KEY)!.lastAppliedSeq).toBe(5)
    expect(sink).toHaveBeenCalledOnce()
    expect(latestAttach().subscription_id).not.toBe(initialId)
    expect(latestAttach().since_seq).toBeUndefined()

    deliver(snapshot(5, "complete reply"))
    expect(sink).toHaveBeenCalledTimes(2)
    expect(sink).toHaveBeenLastCalledWith(
      h.store!.getConnection(KEY)!.liveMessage,
      true
    )
    expect(liveText()).toBe("complete reply")
    expect(h.sent.filter((frame) => frame.action === "attach")).toHaveLength(2)
  })

  it("keeps ordinary equal-seq snapshots from replacing local live state", () => {
    const sink = vi.fn()
    h.actions!.registerLiveMessageSink(KEY, sink)
    deliver(snapshot(5, "current reply"))
    sink.mockClear()

    deliver(snapshot(5, "must not replace the current reply"))

    expect(liveText()).toBe("current reply")
    expect(sink).not.toHaveBeenCalled()
    expect(h.store!.getConnection(KEY)!.lastAppliedSeq).toBe(5)
  })

  it("never rolls the live turn back to an older recovery snapshot", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const sink = vi.fn().mockImplementationOnce(() => {
      throw new Error("runtime mirror failed")
    })
    h.actions!.registerLiveMessageSink(KEY, sink)
    deliver(snapshot(5, "current reply"))

    deliver({ ...snapshot(4, "older reply"), status: "connected" })

    expect(liveText()).toBe("current reply")
    expect(h.store!.getConnection(KEY)!.status).toBe("prompting")
    expect(h.store!.getConnection(KEY)!.lastAppliedSeq).toBe(5)
    expect(sink).toHaveBeenCalledOnce()
  })
})
