import { useEffect } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AcpConnectionsProvider,
  STREAM_FLUSH_FRAME_MS,
  STREAM_FLUSH_MAX_MS,
  useAcpActions,
  useConnectionStore,
} from "@/contexts/acp-connections-context"
import { generationStatsFromLiveMessage } from "@/lib/live-generation-stats"
import type { AttachHandlers } from "@/lib/transport/types"
import type { AcpEvent, AgentType } from "@/lib/types"

// Independent provider harness: these contracts survive replacement of the
// upstream unit suite and exercise the downstream sinks, panels and metrics.
const h = vi.hoisted(() => ({
  actions: null as ReturnType<typeof useAcpActions> | null,
  store: null as ReturnType<typeof useConnectionStore> | null,
  handlers: new Map<string, AttachHandlers>(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  pushAlert: vi.fn(),
}))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/contexts/alert-context", () => ({
  useAlertContext: () => ({ pushAlert: h.pushAlert }),
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: { path: "/work", name: "work" } }),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn(async () => () => {}),
  getEventStream: () => ({
    attach: (id: string, _options: unknown, handlers: AttachHandlers) => {
      h.handlers.set(id, handlers)
      return { detach: vi.fn() }
    },
  }),
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
  acpGetAgentStatus: vi.fn(async (agentType: AgentType) => ({
    agent_type: agentType,
    enabled: true,
    available: true,
    installed_version: "1.0.0",
    host_tools_agent_mode: false,
    is_acp_adapter: true,
  })),
  acpFindConnectionForConversation: vi.fn(async () => null),
  acpConnect: h.connect,
  acpDisconnect: h.disconnect,
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

function Probe() {
  const actions = useAcpActions()
  const store = useConnectionStore()
  useEffect(() => {
    h.actions = actions
    h.store = store
  }, [actions, store])
  return null
}

const seqs = new Map<string, number>()
function emit(id: string, event: AcpEvent) {
  const seq = (seqs.get(id) ?? 0) + 1
  seqs.set(id, seq)
  act(() => h.handlers.get(id)!.onEvent({ ...event, connection_id: id, seq }))
}
function tick(ms: number) {
  act(() => vi.advanceTimersByTime(ms))
}
function liveText(key: string) {
  return h
    .store!.getConnection(key)
    ?.liveMessage?.content.map((block) =>
      block.type === "text" ? block.text : ""
    )
    .join("")
}
async function connect(key: string, agentType: AgentType = "claude_code") {
  h.connect.mockResolvedValueOnce(key)
  await act(async () => {
    await h.actions!.connect(key, agentType, `/work/${key}`)
  })
  emit(key, { type: "status_changed", status: "prompting" })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000)
  h.handlers.clear()
  seqs.clear()
  h.connect.mockReset()
  h.disconnect.mockReset().mockResolvedValue(undefined)
  render(
    <AcpConnectionsProvider>
      <Probe />
    </AcpConnectionsProvider>
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const longReply = "a".repeat(100_000)

describe("MaxCode contract: streaming across retained sessions", () => {
  it("keeps split-panel and background streams independent of active-key switches and remounts", async () => {
    await connect("left")
    await connect("right", "codex")
    h.actions!.registerOpenTabKeys(new Set(["left", "right"]))
    h.actions!.registerLiveSurfaceKeys("split", new Set(["left", "right"]))
    h.actions!.setActiveKey("left")
    const leftSink = vi.fn()
    const rightSink = vi.fn()
    const detachLeft = h.actions!.registerLiveMessageSink("left", leftSink)
    h.actions!.registerLiveMessageSink("right", rightSink)

    emit("left", { type: "content_delta", text: longReply })
    tick(STREAM_FLUSH_FRAME_MS)
    leftSink.mockClear()
    rightSink.mockClear()
    emit("left", { type: "content_delta", text: " retained" })
    emit("right", { type: "content_delta", text: "fast reply" })
    h.actions!.setActiveKey("right")
    detachLeft()
    h.actions!.registerLiveSurfaceKeys("split", new Set(["right"]))

    tick(STREAM_FLUSH_FRAME_MS)
    expect(liveText("right")).toBe("fast reply")
    expect(rightSink).toHaveBeenCalledOnce()
    expect(liveText("left")).toBe(longReply)
    tick(STREAM_FLUSH_MAX_MS - STREAM_FLUSH_FRAME_MS)
    expect(liveText("left")).toBe(`${longReply} retained`)
    expect(leftSink).not.toHaveBeenCalled()
    expect(h.disconnect).not.toHaveBeenCalled()

    const remountedSink = vi.fn()
    h.actions!.registerLiveMessageSink("left", remountedSink)
    expect(remountedSink).toHaveBeenCalledWith(
      h.store!.getConnection("left")!.liveMessage,
      true
    )
  })

  it.each(["visibilitychange", "pageshow"])(
    "flushes every retained connection immediately on %s wake-up",
    async (eventName) => {
      await connect("left")
      await connect("right", "deepseek")
      for (const key of ["left", "right"]) {
        emit(key, { type: "content_delta", text: longReply })
      }
      tick(STREAM_FLUSH_FRAME_MS)
      const idleTimers = vi.getTimerCount()
      const visibility = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden")
      for (const key of ["left", "right"]) {
        emit(key, { type: "content_delta", text: key })
      }
      expect(vi.getTimerCount()).toBe(idleTimers + 2)
      visibility.mockReturnValue("visible")
      act(() => {
        const target = eventName === "pageshow" ? window : document
        target.dispatchEvent(new Event(eventName))
      })
      expect(liveText("left")).toBe(longReply + "left")
      expect(liveText("right")).toBe(longReply + "right")
      expect(vi.getTimerCount()).toBe(idleTimers)
    }
  )

  it("preserves queued text, runtime-sink delivery and timing when a retained session is rekeyed", async () => {
    await connect("new-session")
    emit("new-session", { type: "session_started", session_id: "session-1" })
    tick(50)
    emit("new-session", { type: "content_delta", text: longReply })
    tick(STREAM_FLUSH_FRAME_MS)
    tick(10)
    emit("new-session", { type: "content_delta", text: " last words" })
    const sink = vi.fn()
    h.actions!.registerLiveMessageSink("reopened", sink)
    await act(async () => {
      await h.actions!.connect(
        "reopened",
        "claude_code",
        "/work/new-session",
        "session-1"
      )
    })
    expect(h.connect).toHaveBeenCalledOnce()
    expect(h.store!.getConnection("new-session")).toBeUndefined()
    expect(liveText("reopened")).toBe(`${longReply} last words`)
    expect(sink).toHaveBeenCalledWith(
      h.store!.getConnection("reopened")!.liveMessage,
      true
    )
    expect(
      h.store!.getConnection("reopened")!.liveMessage!.generationTiming?.steps
    ).toEqual([
      {
        startedAt: 1_000,
        firstTokenAt: 1_050,
        lastTokenAt: 1_076,
        startContentIndex: 0,
      },
    ])
    tick(STREAM_FLUSH_MAX_MS)
    expect(liveText("reopened")).toBe(`${longReply} last words`)
  })

  it("discards all pending batches before waiting for backend shutdown", async () => {
    await connect("left")
    await connect("right", "codex")
    const idleTimers = vi.getTimerCount()
    emit("left", { type: "content_delta", text: "closed left" })
    emit("right", { type: "content_delta", text: "closed right" })
    let finishDisconnect!: () => void
    h.disconnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDisconnect = resolve
        })
    )
    // Only one teardown blocks; the other connection can settle immediately.
    h.disconnect.mockResolvedValueOnce(undefined)
    let done!: Promise<void>
    act(() => {
      done = h.actions!.disconnectAll()
    })
    expect(vi.getTimerCount()).toBe(idleTimers)
    tick(STREAM_FLUSH_MAX_MS)
    expect(liveText("left")).toBe("")
    expect(liveText("right")).toBe("")
    await act(async () => {
      finishDisconnect()
      await done
    })
    expect(h.store!.getConnection("left")).toBeUndefined()
    expect(h.store!.getConnection("right")).toBeUndefined()
  })

  it("measures generation at delta arrival, excluding empty placeholders and render delays", async () => {
    await connect("metrics", "deepseek")
    emit("metrics", { type: "thinking", text: "" })
    tick(5)
    emit("metrics", { type: "thinking", text: "reason" })
    tick(5)
    emit("metrics", { type: "thinking", text: " more" })
    tick(6)
    expect(
      h.store!.getConnection("metrics")!.liveMessage!.generationTiming?.steps
    ).toEqual([
      {
        startedAt: 1_000,
        firstTokenAt: 1_005,
        lastTokenAt: 1_010,
        startContentIndex: 0,
      },
    ])

    emit("metrics", { type: "content_delta", text: longReply })
    tick(STREAM_FLUSH_FRAME_MS)
    emit("metrics", { type: "content_delta", text: " a" })
    tick(50)
    emit("metrics", { type: "content_delta", text: " b" })
    tick(STREAM_FLUSH_MAX_MS - 50)
    const message = h.store!.getConnection("metrics")!.liveMessage!
    expect(message.generationTiming?.steps[0]).toMatchObject({
      firstTokenAt: 1_005,
      lastTokenAt: 1_082,
    })
    expect(generationStatsFromLiveMessage(message, 1_224)).toMatchObject({
      ttft_ms: 5,
      ttft_steps: 1,
      decode_ms: 219,
    })
  })
})
