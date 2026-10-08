import { useEffect } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AcpConnectionsProvider,
  useAcpActions,
  useConnectionStore,
} from "@/contexts/acp-connections-context"
import { WebEventStream } from "@/lib/transport/web-event-stream"
import {
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"
import type {
  DbConversationDetail,
  EventEnvelope,
  LiveSessionSnapshot,
  MessageTurn,
} from "@/lib/types"

// Exercise the real subscription cursor, provider reducer and runtime store.
// A pong/agent liveness check alone cannot prove this session stream is current.
const h = vi.hoisted(() => ({
  actions: null as ReturnType<typeof useAcpActions> | null,
  store: null as ReturnType<typeof useConnectionStore> | null,
  stream: null as WebEventStream | null,
  sent: [] as Array<{
    action: string
    subscription_id: string
    connection_id?: string
    since_seq?: number
  }>,
  acpConnect: vi.fn(),
  acpDisconnect: vi.fn(),
  acpProbeConnection: vi.fn(),
  getFolderConversation: vi.fn(),
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
  acpConnect: h.acpConnect,
  acpDisconnect: h.acpDisconnect,
  acpGetSessionSnapshot: vi.fn(async () => null),
  acpPrompt: vi.fn(),
  acpSetMode: vi.fn(),
  acpSetConfigOption: vi.fn(),
  acpCancel: vi.fn(),
  acpRespondPermission: vi.fn(),
  acpProbeConnection: h.acpProbeConnection,
  acpTouchConnection: vi.fn(async () => true),
  getFolderConversation: h.getFolderConversation,
}))

const KEY = "mobile-conversation"
const RUNTIME_ID = -42
const USER: MessageTurn = {
  id: "prompt",
  role: "user",
  blocks: [{ type: "text", text: "finish this task" }],
  timestamp: "2026-10-02T00:00:00Z",
}

function Probe() {
  const actions = useAcpActions()
  const store = useConnectionStore()
  useEffect(() => {
    h.actions = actions
    h.store = store
    return actions.registerLiveMessageSink(KEY, (message, isLive) => {
      useConversationRuntimeStore
        .getState()
        .actions.setLiveMessage(RUNTIME_ID, message, isLive)
    })
  }, [actions, store])
  return null
}

function snapshot(seq: number, text = "partial reply"): LiveSessionSnapshot {
  return {
    connection_id: "connection",
    conversation_id: 42,
    folder_id: 1,
    status: "prompting",
    external_id: "session",
    live_message: {
      id: "reply",
      role: "assistant",
      content: [{ kind: "text", text }],
      started_at: "2026-10-02T00:00:01Z",
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

function detail(withReply: boolean): DbConversationDetail {
  return {
    summary: {
      id: 42,
      folder_id: 1,
      title: "task",
      title_locked: false,
      agent_type: "claude_code",
      status: "completed",
      kind: "regular",
      model: null,
      git_branch: null,
      external_id: "session",
      message_count: withReply ? 2 : 1,
      child_count: 0,
      created_at: USER.timestamp,
      updated_at: "2026-10-02T00:00:10Z",
      pinned_at: null,
    },
    turns: withReply
      ? [
          { ...USER, id: "turn-0" },
          {
            id: "turn-1",
            role: "assistant",
            blocks: [{ type: "text", text: "the complete reply" }],
            timestamp: "2026-10-02T00:00:10Z",
          },
        ]
      : [{ ...USER, id: "turn-0" }],
    session_stats: null,
  }
}

function latestAttach() {
  const frames = h.sent.filter((item) => item.action === "attach")
  const frame = frames[frames.length - 1]
  if (!frame) throw new Error("expected an attach request")
  return frame
}

function deliverSnapshot(value: LiveSessionSnapshot) {
  act(() => {
    h.stream!.handleServerFrame({
      type: "snapshot",
      subscription_id: latestAttach().subscription_id,
      connection_id: value.connection_id,
      event_seq: value.event_seq,
      snapshot: value,
    })
  })
}

function deliverEvent(envelope: EventEnvelope) {
  act(() => {
    h.stream!.handleServerFrame({
      type: "event",
      subscription_id: latestAttach().subscription_id,
      envelope,
    })
  })
}

function runtimeSession() {
  return useConversationRuntimeStore
    .getState()
    .byConversationId.get(RUNTIME_ID)!
}

function liveText() {
  return h
    .store!.getConnection(KEY)
    ?.liveMessage?.content.map((block) =>
      block.type === "text" ? block.text : ""
    )
    .join("")
}

async function reuseConnection() {
  await act(async () => {
    await h.actions!.connect(KEY, "claude_code", "/work", "session", 42)
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  resetConversationRuntimeStore()
  h.sent = []
  h.acpConnect.mockReset().mockResolvedValue("connection")
  h.acpDisconnect.mockReset().mockResolvedValue(undefined)
  h.acpProbeConnection.mockReset().mockResolvedValue(true)
  h.getFolderConversation.mockReset().mockResolvedValue(detail(true))
  const runtime = useConversationRuntimeStore.getState().actions
  runtime.setExternalId(RUNTIME_ID, "session")
  runtime.setDbConversationId(RUNTIME_ID, 42)
  runtime.appendOptimisticTurn(RUNTIME_ID, USER, USER.id)
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
  await reuseConnection()
})

afterEach(() => {
  cleanup()
  h.stream?.destroy()
  h.stream = null
  resetConversationRuntimeStore()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("MaxCode contract: mobile session catchup", () => {
  it("reattaches a live prompting session from its applied cursor and replays the completed reply", async () => {
    deliverSnapshot(snapshot(5, "first "))
    const oldId = latestAttach().subscription_id
    await reuseConnection()

    expect(h.acpProbeConnection).toHaveBeenCalledWith("connection")
    expect(latestAttach().subscription_id).not.toBe(oldId)
    expect(latestAttach().since_seq).toBe(5)
    expect(h.sent).toContainEqual({ action: "detach", subscription_id: oldId })
    const events: EventEnvelope[] = [
      {
        type: "content_delta",
        connection_id: "connection",
        seq: 6,
        text: "final reply",
      },
      {
        type: "turn_complete",
        connection_id: "connection",
        session_id: "session",
        seq: 7,
        stop_reason: "end_turn",
      },
    ]
    act(() => {
      h.stream!.handleServerFrame({
        type: "replay",
        subscription_id: latestAttach().subscription_id,
        connection_id: "connection",
        events,
        high_water_seq: 7,
      })
    })

    expect(h.store!.getConnection(KEY)?.status).toBe("connected")
    expect(h.store!.getConnection(KEY)?.lastAppliedSeq).toBe(7)
    expect(liveText()).toBe("first final reply")
    expect(h.acpConnect).toHaveBeenCalledOnce()
    expect(h.acpDisconnect).not.toHaveBeenCalled()
    expect(h.getFolderConversation).not.toHaveBeenCalled()
  })

  it("isolates old subscription frames after reattaching a retained connected session", async () => {
    deliverSnapshot({ ...snapshot(5), status: "connected", live_message: null })
    const oldId = latestAttach().subscription_id
    await reuseConnection()
    act(() => {
      h.stream!.handleServerFrame({
        type: "detached",
        subscription_id: oldId,
        reason: "connection_gone",
      })
      h.stream!.handleServerFrame({
        type: "event",
        subscription_id: oldId,
        envelope: {
          type: "status_changed",
          connection_id: "connection",
          seq: 6,
          status: "prompting",
        },
      })
    })

    expect(h.store!.getConnection(KEY)?.status).toBe("connected")
    expect(h.store!.getConnection(KEY)?.lastAppliedSeq).toBe(5)
    expect(latestAttach().since_seq).toBe(5)
    expect(h.acpConnect).toHaveBeenCalledOnce()
    expect(h.acpDisconnect).not.toHaveBeenCalled()
  })

  it("does not reattach a tab closed while its liveness probe was pending", async () => {
    deliverSnapshot(snapshot(5))
    let resolveProbe!: (alive: boolean) => void
    h.acpProbeConnection.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (resolveProbe = resolve))
    )
    let pending!: Promise<void>
    await act(async () => {
      pending = h.actions!.connect(KEY, "claude_code", "/work", "session", 42)
    })
    await act(async () => {
      await h.actions!.disconnect(KEY)
      resolveProbe(true)
      await pending
    })

    expect(h.sent.filter((frame) => frame.action === "attach")).toHaveLength(1)
    expect(h.store!.getConnection(KEY)).toBeUndefined()
    expect(h.acpConnect).toHaveBeenCalledOnce()
  })

  it("recovers a large gap from the complete disk reply without losing live content during transcript flush", async () => {
    deliverSnapshot(snapshot(5))
    await reuseConnection()
    h.getFolderConversation
      .mockResolvedValueOnce(detail(false))
      .mockResolvedValueOnce(detail(true))
    deliverSnapshot({
      ...snapshot(100),
      status: "connected",
      live_message: null,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    let runtime = useConversationRuntimeStore
      .getState()
      .byConversationId.get(RUNTIME_ID)!
    expect(runtime.syncState).toBe("awaiting_persist")
    expect(runtime.liveMessage?.content).toEqual([
      { type: "text", text: "partial reply" },
    ])
    expect(runtime.detail).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    runtime = useConversationRuntimeStore
      .getState()
      .byConversationId.get(RUNTIME_ID)!
    expect(h.getFolderConversation).toHaveBeenCalledWith(42, { tailTurns: 120 })
    expect(h.getFolderConversation).toHaveBeenCalledTimes(2)
    expect(runtime.detail?.turns).toEqual(detail(true).turns)
    expect(runtime.liveMessage).toBeNull()
    expect(runtime.optimisticTurns).toEqual([])
    expect(runtime.localTurns).toEqual([])
    expect(runtime.syncState).toBe("idle")
    expect(runtime.activeTurnToken).toBeNull()
    expect(h.acpConnect).toHaveBeenCalledOnce()
    expect(h.acpDisconnect).not.toHaveBeenCalled()
  })

  it("never lets a settled recovery fetch overwrite a newly sent prompt", async () => {
    deliverSnapshot(snapshot(5))
    let resolveDetail!: (value: DbConversationDetail) => void
    h.getFolderConversation.mockImplementationOnce(
      () =>
        new Promise<DbConversationDetail>(
          (resolve) => (resolveDetail = resolve)
        )
    )
    deliverSnapshot({
      ...snapshot(100),
      status: "connected",
      live_message: null,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const newPrompt = { ...USER, id: "next-prompt" }
    act(() => {
      useConversationRuntimeStore
        .getState()
        .actions.appendOptimisticTurn(RUNTIME_ID, newPrompt, newPrompt.id)
    })
    await act(async () => resolveDetail(detail(true)))

    const runtime = useConversationRuntimeStore
      .getState()
      .byConversationId.get(RUNTIME_ID)!
    expect(runtime.syncState).toBe("awaiting_persist")
    expect(runtime.activeTurnToken).toBe(newPrompt.id)
    expect(runtime.optimisticTurns).toContainEqual(newPrompt)
    expect(runtime.detail).toBeNull()
  })

  it("does not start disk recovery for an older or foreign settled snapshot", async () => {
    deliverSnapshot(snapshot(5))
    deliverSnapshot({ ...snapshot(4), status: "connected", live_message: null })
    deliverSnapshot({
      ...snapshot(100),
      connection_id: "old-connection",
      status: "connected",
      live_message: null,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(h.getFolderConversation).not.toHaveBeenCalled()
    expect(h.store!.getConnection(KEY)?.status).toBe("prompting")
    expect(liveText()).toBe("partial reply")
  })

  it("keeps same-turn disk recovery alive when usage events advance the stream", async () => {
    deliverSnapshot(snapshot(5))
    deliverSnapshot({
      ...snapshot(100),
      status: "connected",
      live_message: null,
    })
    deliverEvent({
      type: "usage_update",
      connection_id: "connection",
      seq: 101,
      used: 123,
      size: 1000,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(h.store!.getConnection(KEY)?.lastAppliedSeq).toBe(101)
    expect(runtimeSession().detail?.turns).toEqual(detail(true).turns)
    expect(runtimeSession().syncState).toBe("idle")
  })

  it("ignores an old recovery response after a newer turn starts and finishes", async () => {
    deliverSnapshot(snapshot(5))
    let resolveDetail!: (value: DbConversationDetail) => void
    h.getFolderConversation.mockImplementationOnce(
      () =>
        new Promise<DbConversationDetail>(
          (resolve) => (resolveDetail = resolve)
        )
    )
    deliverSnapshot({
      ...snapshot(100),
      status: "connected",
      live_message: null,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    act(() => {
      useConversationRuntimeStore.getState().actions.completeTurn(RUNTIME_ID)
    })
    deliverEvent({
      type: "status_changed",
      connection_id: "connection",
      seq: 101,
      status: "prompting",
    })
    deliverEvent({
      type: "content_delta",
      connection_id: "connection",
      seq: 102,
      text: "newer complete reply",
    })
    deliverEvent({
      type: "turn_complete",
      connection_id: "connection",
      session_id: "session",
      seq: 103,
      stop_reason: "end_turn",
    })
    act(() => {
      useConversationRuntimeStore.getState().actions.completeTurn(RUNTIME_ID)
    })
    const newTurns = runtimeSession().localTurns
    await act(async () => resolveDetail(detail(true)))

    expect(runtimeSession().localTurns).toBe(newTurns)
    expect(newTurns[newTurns.length - 1]?.blocks).toEqual([
      { type: "text", text: "newer complete reply" },
    ])
    expect(runtimeSession().detail).toBeNull()
  })

  it("waits through empty and old settled reads until this prompt's reply appears", async () => {
    const old = detail(true)
    old.turns[0] = {
      ...USER,
      id: "old-prompt",
      blocks: [{ type: "text", text: "old task" }],
    }
    h.getFolderConversation
      .mockResolvedValueOnce({ ...detail(false), turns: [] })
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(detail(true))
    deliverSnapshot(snapshot(5))
    deliverSnapshot({
      ...snapshot(100),
      status: "connected",
      live_message: null,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(h.getFolderConversation).toHaveBeenCalledTimes(2)
    expect(runtimeSession().syncState).toBe("awaiting_persist")
    expect(runtimeSession().liveMessage).not.toBeNull()
    expect(runtimeSession().detail).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(runtimeSession().detail?.turns).toEqual(detail(true).turns)
    expect(runtimeSession().syncState).toBe("idle")
  })

  it("retries a failed recovery on the next wake after the half reply was promoted", async () => {
    h.getFolderConversation.mockRejectedValue(new Error("radio offline"))
    deliverSnapshot(snapshot(5))
    deliverSnapshot({
      ...snapshot(100),
      status: "connected",
      live_message: null,
    })
    act(() => {
      useConversationRuntimeStore.getState().actions.completeTurn(RUNTIME_ID)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5300)
    })
    expect(h.getFolderConversation).toHaveBeenCalledTimes(5)
    expect(runtimeSession().localTurns).toHaveLength(2)
    h.getFolderConversation.mockResolvedValue(detail(true))
    await reuseConnection()

    // A caught-up cursor would produce empty replay. A pending disk recovery
    // needs a fresh snapshot to confirm the same round is still settled.
    expect(latestAttach().since_seq).toBeUndefined()
    deliverSnapshot({
      ...snapshot(100),
      status: "connected",
      live_message: null,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(runtimeSession().detail?.turns).toEqual(detail(true).turns)
    expect(runtimeSession().localTurns).toEqual([])
    await reuseConnection()
    expect(latestAttach().since_seq).toBe(100)
  })

  it("continues bounded recovery after a panel fetch supersedes the first complete read", async () => {
    let resolveRecovery!: (value: DbConversationDetail) => void
    let resolvePanel!: (value: DbConversationDetail) => void
    h.getFolderConversation
      .mockImplementationOnce(
        () =>
          new Promise<DbConversationDetail>(
            (resolve) => (resolveRecovery = resolve)
          )
      )
      .mockImplementationOnce(
        () =>
          new Promise<DbConversationDetail>(
            (resolve) => (resolvePanel = resolve)
          )
      )
      .mockResolvedValueOnce(detail(true))
    deliverSnapshot(snapshot(5))
    deliverSnapshot({
      ...snapshot(100),
      status: "connected",
      live_message: null,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      useConversationRuntimeStore
        .getState()
        .actions.refetchDetail(RUNTIME_ID, { preserveLive: true })
      resolveRecovery(detail(true))
      await Promise.resolve()
      resolvePanel(detail(false))
    })
    expect(runtimeSession().syncState).toBe("awaiting_persist")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(h.getFolderConversation).toHaveBeenCalledTimes(3)
    expect(runtimeSession().detail?.turns).toEqual(detail(true).turns)
    expect(runtimeSession().syncState).toBe("idle")
  })
})
