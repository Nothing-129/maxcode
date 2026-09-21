#!/usr/bin/env node
// zcode-acp — MaxCode's ACP adapter for the ZCode agent runtime.
//
// Speaks Agent Client Protocol (ACP v1, ndjson JSON-RPC 2.0) on stdio and
// drives a `zcode app-server --stdio` child through the ZCode Protocol
// (newline-delimited JSON envelopes: {id,method,params} / {id,result} /
// {id,error} / {method,params}).
//
// The zcode runtime is located in this order:
//   1. $ZCODE_CLI (file path; a *.cjs bundle is run with the current node)
//   2. `zcode` on PATH
//   3. ~/.local/bin/zcode (install.sh location)
//   4. The ZCode desktop app bundles (macOS: /Applications and ~/Applications,
//      Windows: %LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs)
//
// Optional environment:
//   ZCODE_MODE   — initial zcode permission mode (build|edit|plan|yolo;
//                 default build so permission requests reach the host UI)
//   ZCODE_MODEL  — JSON {providerId, modelId, reasoningLevel?} pinned onto
//                 every session create/send (e.g. a test endpoint provider)
//
// No third-party dependencies; requires Node >= 18.

import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function log(...args) {
  process.stderr.write(`[zcode-acp] ${args.join(" ")}\n`)
}

function jsonParse(text, fallback) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// ACP side (host on stdin/stdout)
// ---------------------------------------------------------------------------

const JSONRPC = "2.0"
let stdoutBuffer = ""
const acpPending = new Map() // id -> {resolve, reject}
let nextAcpRequestId = 1
const acpIncomingHandlers = new Map() // method -> handler(params) | async

function acpSend(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function acpRespond(id, result) {
  acpSend({ jsonrpc: JSONRPC, id, result })
}

function acpRespondError(id, code, message) {
  acpSend({ jsonrpc: JSONRPC, id, error: { code, message } })
}

function acpNotify(method, params) {
  acpSend({ jsonrpc: JSONRPC, method, params })
}

function acpRequest(method, params) {
  const id = nextAcpRequestId++
  return new Promise((resolvePromise, rejectPromise) => {
    acpPending.set(id, { resolve: resolvePromise, reject: rejectPromise })
    acpSend({ jsonrpc: JSONRPC, id, method, params })
    // ACP permission requests can wait a long time for the user; no timeout.
  })
}

function sessionUpdate(sessionId, update) {
  acpNotify("session/update", {
    sessionId,
    update,
  })
}

function contentBlockText(text) {
  return { type: "text", text }
}

// ---------------------------------------------------------------------------
// ZCode side (child process on stdio)
// ---------------------------------------------------------------------------

let zcodeChild = null
let zcodeBuffer = ""
const zcodePending = new Map() // id -> {resolve, reject, method}
let nextZcodeRequestId = 1
const zcodeIncomingHandlers = new Map() // method -> handler(msg)

function zcodeSend(message) {
  if (!zcodeChild || zcodeChild.killed || !zcodeChild.stdin.writable) {
    throw new Error("zcode app-server transport is closed")
  }
  zcodeChild.stdin.write(`${JSON.stringify(message)}\n`)
}

function zcodeRequest(method, params, timeoutMs = 180000) {
  const id = nextZcodeRequestId++
  return new Promise((resolvePromise, rejectPromise) => {
    zcodePending.set(id, {
      resolve: resolvePromise,
      reject: rejectPromise,
      method,
    })
    try {
      zcodeSend({ id, method, params })
    } catch (error) {
      zcodePending.delete(id)
      rejectPromise(error)
      return
    }
    if (timeoutMs > 0) {
      const timer = setTimeout(() => {
        if (zcodePending.has(id)) {
          zcodePending.delete(id)
          rejectPromise(new Error(`zcode request timed out: ${method}`))
        }
      }, timeoutMs)
      timer.unref?.()
    }
  })
}

function handleZcodeMessage(message) {
  if (!message || typeof message !== "object") return
  if ("id" in message && "method" in message) {
    const handler = zcodeIncomingHandlers.get(message.method)
    if (handler) {
      Promise.resolve(handler(message.params))
        .then((result) => zcodeSend({ id: message.id, result }))
        .catch((error) =>
          zcodeSend({
            id: message.id,
            error: { code: -32000, message: error?.message ?? String(error) },
          })
        )
    } else {
      // Unknown server->client request: answer so the CLI does not stall.
      log(`unhandled zcode request: ${message.method}`)
      zcodeSend({
        id: message.id,
        error: {
          code: -32601,
          message: `zcode-acp does not implement ${message.method}`,
        },
      })
    }
    return
  }
  if ("id" in message && ("result" in message || "error" in message)) {
    const pending = zcodePending.get(message.id)
    if (pending) {
      zcodePending.delete(message.id)
      if ("error" in message && message.error) {
        pending.reject(
          Object.assign(new Error(message.error.message ?? "zcode error"), {
            code: message.error.code,
            data: message.error.data,
          })
        )
      } else {
        pending.resolve(message.result)
      }
    }
    return
  }
  if ("method" in message) {
    if (message.method === "session/event") {
      dispatchSessionEvent(message.params)
    } else if (message.method === "state.updated") {
      dispatchStateUpdated(message.params)
    } else {
      log(`zcode notification: ${message.method}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Locating the zcode runtime
// ---------------------------------------------------------------------------

function macAppBundleCandidates() {
  const roots = [join(homedir(), "Applications"), "/Applications"]
  const bundles = []
  for (const root of roots) {
    bundles.push(
      join(root, "ZCode.app", "Contents", "Resources", "glm", "zcode.cjs")
    )
  }
  return bundles
}

function windowsAppCandidates() {
  const localAppData = process.env.LOCALAPPDATA
  const candidates = []
  if (localAppData) {
    candidates.push(
      join(localAppData, "Programs", "ZCode", "resources", "glm", "zcode.cjs")
    )
  }
  candidates.push(
    join(
      homedir(),
      "AppData",
      "Local",
      "Programs",
      "ZCode",
      "resources",
      "glm",
      "zcode.cjs"
    )
  )
  return candidates
}

function findZcodeEntry() {
  const override = process.env.ZCODE_CLI?.trim()
  if (override) return { entry: resolve(override), via: "ZCODE_CLI" }

  const pathCandidate = process.env.PATH?.split(
    process.platform === "win32" ? ";" : ":"
  )
    .map((dir) =>
      join(dir, process.platform === "win32" ? "zcode.cmd" : "zcode")
    )
    .find((candidate) => existsSync(candidate))
  if (pathCandidate) return { entry: pathCandidate, via: "PATH" }

  const homeCandidate = join(homedir(), ".local", "bin", "zcode")
  if (existsSync(homeCandidate))
    return { entry: homeCandidate, via: "~/.local/bin" }

  const bundleCandidates = [
    ...(process.platform === "darwin" ? macAppBundleCandidates() : []),
    ...(process.platform === "win32" ? windowsAppCandidates() : []),
  ]
  for (const candidate of bundleCandidates) {
    if (existsSync(candidate)) return { entry: candidate, via: "app bundle" }
  }
  return null
}

function zcodeCommandFor(entry) {
  // A .cjs bundle is the runtime shipped inside the desktop app / dist tarball:
  // run it with the same node that runs this adapter.
  if (
    entry.endsWith(".cjs") ||
    entry.endsWith(".js") ||
    entry.endsWith(".mjs")
  ) {
    return [process.execPath, entry]
  }
  return [entry]
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

// acpSessionId === zcode sessionId (sess_...), so reconnects and parser data
// line up with zero translation.
const sessions = new Map() // sessionId -> SessionState

// Official ZCode permission modes (ZJt in the desktop bundle). `auto` is a
// runtime alias the protocol enum accepts; the picker surfaces the four
// user-facing ids and maps anything else to build.
const ZCODE_MODES = [
  {
    id: "build",
    name: "Ask before changes",
    description: "Ask before each file changes.",
  },
  {
    id: "edit",
    name: "Edit automatically",
    description:
      "Edit selected files or relevant workspace files automatically.",
  },
  {
    id: "plan",
    name: "Plan mode",
    description: "Inspect the code and present a plan before editing.",
  },
  {
    id: "yolo",
    name: "Full access",
    description: "Edit and run commands with fewer confirmations.",
  },
]
const ZCODE_MODE_IDS = new Set(ZCODE_MODES.map((mode) => mode.id))

function normalizeZcodeMode(mode) {
  return ZCODE_MODE_IDS.has(mode) ? mode : "build"
}

function initialZcodeMode() {
  return normalizeZcodeMode(process.env.ZCODE_MODE?.trim() || "build")
}

function sessionModesState(currentMode) {
  return {
    currentModeId: normalizeZcodeMode(currentMode),
    availableModes: ZCODE_MODES.map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description,
    })),
  }
}

function emitCurrentMode(session) {
  if (!session?.currentMode) return
  sessionUpdate(session.sessionId, {
    sessionUpdate: "current_mode_update",
    currentModeId: session.currentMode,
  })
}

function applyCurrentMode(session, mode, { emit = true } = {}) {
  if (!session || mode == null) return
  const id = normalizeZcodeMode(
    typeof mode === "string" ? mode : (mode.current ?? mode.mode ?? mode)
  )
  if (session.currentMode === id) return
  session.currentMode = id
  if (emit) {
    emitCurrentMode(session)
    session.emitConfigOptions()
  }
}

class SessionState {
  constructor(sessionId, cwd) {
    this.sessionId = sessionId
    this.cwd = cwd
    this.currentMode = initialZcodeMode()
    this.subscribed = false
    /** Resolves the in-flight `session/prompt` — ACP keeps one prompt per
     * session in flight, so a single slot is the whole state machine. */
    this.promptResolver = null
    /** @type {Set<string>} */
    this.seenToolCalls = new Set()
    /** Model catalog from `state.updated` patches, keyed by "provider/model"
     * (the ACP config-option value id). @type {Map<string, {name: string, description: string, levels: string[]}>} */
    this.modelsByValue = new Map()
    /** @type {{value: string, reasoningLevel: string|null}} */
    this.currentModel = null
  }

  /** Rebuild the ACP config options for the composer's Mode / Model /
   * Reasoning pickers. Mode is a config option (not ACP session-modes)
   * because the composer hides the session-mode chip whenever any config
   * option is present. */
  configOptions() {
    const options = [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: normalizeZcodeMode(this.currentMode),
        options: ZCODE_MODES.map((mode) => ({
          value: mode.id,
          name: mode.name,
          description: mode.description,
        })),
      },
    ]
    if (this.modelsByValue.size > 0) {
      const entries = [...this.modelsByValue.entries()].map(
        ([value, entry]) => ({
          value,
          name: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
        })
      )
      const currentEntry = this.currentModel?.value
        ? this.modelsByValue.get(this.currentModel.value)
        : undefined
      options.push({
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue:
          this.currentModel?.value &&
          this.modelsByValue.has(this.currentModel.value)
            ? this.currentModel.value
            : (entries[0]?.value ?? ""),
        options: entries,
      })
      const levels = currentEntry?.levels ?? []
      if (levels.length > 1) {
        options.push({
          id: "reasoning",
          name: "Reasoning",
          category: "thought_level",
          type: "select",
          currentValue:
            this.currentModel?.reasoningLevel &&
            levels.includes(this.currentModel.reasoningLevel)
              ? this.currentModel.reasoningLevel
              : (levels[0] ?? ""),
          options: levels.map((level) => ({ value: level, name: level })),
        })
      }
    }
    return options
  }

  emitConfigOptions() {
    const configOptions = this.configOptions()
    if (configOptions.length === 0) return
    sessionUpdate(this.sessionId, {
      sessionUpdate: "config_option_update",
      configOptions,
    })
  }

  resolvePrompt(stopReason) {
    if (process.env.ZCODE_ACP_DEBUG === "1") {
      log(
        `resolvePrompt ${stopReason} resolver=${this.promptResolver ? "set" : "none"}`
      )
    }
    if (this.promptResolver) {
      const resolve = this.promptResolver
      this.promptResolver = null
      resolve({ stopReason })
    }
  }
}

function workspaceRefFor(cwd) {
  return { workspacePath: cwd, workspaceKey: cwd }
}

function parseModelOverride() {
  const raw = process.env.ZCODE_MODEL?.trim()
  if (!raw) return undefined
  const parsed = jsonParse(raw, null)
  if (
    parsed &&
    typeof parsed.providerId === "string" &&
    typeof parsed.modelId === "string"
  ) {
    const selection = { providerId: parsed.providerId, modelId: parsed.modelId }
    if (parsed.reasoningLevel) {
      selection.options = { reasoningLevel: String(parsed.reasoningLevel) }
    }
    return selection
  }
  log("ignoring malformed ZCODE_MODEL env")
  return undefined
}

function mapMcpServers(mcpServers) {
  if (!Array.isArray(mcpServers)) return undefined
  const mapped = []
  for (const server of mcpServers) {
    if (!server || typeof server !== "object") continue
    if (typeof server.command === "string") {
      mapped.push({
        name: server.name,
        command: server.command,
        args: Array.isArray(server.args) ? server.args.map(String) : [],
        env: Object.entries(server.env ?? {}).map(([name, value]) => ({
          name,
          value: String(value),
        })),
      })
    } else if (typeof server.url === "string") {
      mapped.push({
        name: server.name,
        type: "http",
        url: server.url,
        headers: Object.entries(server.headers ?? {}).map(([name, value]) => ({
          name,
          value: String(value),
        })),
      })
    }
  }
  return mapped.length > 0 ? mapped : undefined
}

// ---------------------------------------------------------------------------
// ZCode events -> ACP session updates
// ---------------------------------------------------------------------------

const TOOL_KIND_BY_NAME = [
  [/^(bash|shell|terminal|exec|run_)/i, "execute"],
  [/read|view|glob|list|search|grep|find/i, "read"],
  [/edit|write|apply|patch|create/i, "edit"],
  [/think|reason|plan/i, "think"],
  [/fetch|browser|web|open/i, "fetch"],
  [/todo|task/i, "other"],
]

function classifyToolKind(toolName) {
  for (const [pattern, kind] of TOOL_KIND_BY_NAME) {
    if (pattern.test(toolName)) return kind
  }
  return "other"
}

function toolTitle(toolName, input) {
  const base = toolName ?? "tool"
  const command =
    input?.command ?? input?.path ?? input?.file_path ?? input?.pattern
  if (typeof command === "string" && command.length > 0) {
    const oneLine = command.replace(/\s+/g, " ").trim()
    return `${base}: ${oneLine.slice(0, 160)}`
  }
  return base
}

function pushToolContent(session, toolCallId, block) {
  sessionUpdate(session.sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId,
    content: [block],
  })
}

function dispatchSessionEvent(envelope) {
  if (!envelope || !envelope.sessionId) return
  if (process.env.ZCODE_ACP_DEBUG === "1") {
    log(
      `event seq=${envelope.seq} type=${envelope.type} turn=${envelope.turnId ?? "-"}`
    )
  }
  const session = sessions.get(envelope.sessionId)
  if (!session) return
  const payload = envelope.payload ?? {}
  switch (envelope.type) {
    case "turn.started": {
      // The turn id itself is not needed: one prompt slot per session.
      break
    }
    case "model.streaming": {
      const kind = payload.kind
      if (kind === "text_delta" && typeof payload.delta === "string") {
        sessionUpdate(session.sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: contentBlockText(payload.delta),
        })
      } else if (
        kind === "reasoning_delta" &&
        typeof payload.delta === "string"
      ) {
        sessionUpdate(session.sessionId, {
          sessionUpdate: "agent_thought_chunk",
          content: contentBlockText(payload.delta),
        })
      } else if (kind === "tool_call" && payload.toolCallId) {
        // Streaming tool-call input from the model; the authoritative card
        // comes from tool.updated/scheduled, this only enriches it.
        if (!session.seenToolCalls.has(payload.toolCallId)) {
          session.seenToolCalls.add(payload.toolCallId)
          sessionUpdate(session.sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: payload.toolCallId,
            title: payload.toolName ?? "tool",
            kind: classifyToolKind(payload.toolName ?? ""),
            status: "pending",
          })
        }
      }
      break
    }
    case "tool.updated": {
      applyToolUpdated(session, payload)
      break
    }
    case "permission.requested": {
      // The actual bridging happens on the interaction/requestPermission
      // server request; this notification only mirrors it. Nothing to do.
      break
    }
    case "turn.completed": {
      session.resolvePrompt("end_turn")
      break
    }
    case "turn.failed": {
      const error = payload.error
      const message =
        (error && (error.message ?? error.underlyingErrorMessage)) ??
        "turn failed"
      const cancelled =
        payload.cancelled === true ||
        (error && (error.code === "cancelled" || error.type === "cancelled"))
      sessionUpdate(session.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: contentBlockText(
          cancelled ? "_Turn cancelled._" : `_Turn failed: ${message}_`
        ),
      })
      session.resolvePrompt(cancelled ? "cancelled" : "end_turn")
      break
    }
    case "session.updated": {
      // Mid-session switches (the desktop UI, /model, /mode) surface here
      // with the full new selection; keep the composer's pickers in sync.
      if (payload.modelSelection) {
        applyCurrentModel(session, payload.modelSelection)
      }
      if (payload.mode != null) applyCurrentMode(session, payload.mode)
      break
    }
    case "session.titleUpdated": {
      if (typeof payload.title === "string" && payload.title.length > 0) {
        sessionUpdate(session.sessionId, {
          sessionUpdate: "session_info_update",
          title: payload.title,
        })
      }
      break
    }
    default:
      break
  }
}

function applyToolUpdated(session, payload) {
  const toolCallId = payload.toolCallId
  if (!toolCallId) return
  const isNew = !session.seenToolCalls.has(toolCallId)
  session.seenToolCalls.add(toolCallId)

  switch (payload.kind) {
    case "scheduled": {
      const input = payload.input
      const update = {
        toolCallId,
        title: payload.description ?? toolTitle(payload.toolName, input),
        kind: classifyToolKind(payload.toolName ?? ""),
        status: "pending",
        rawInput: input ?? undefined,
      }
      sessionUpdate(session.sessionId, {
        sessionUpdate: isNew ? "tool_call" : "tool_call_update",
        ...(isNew
          ? update
          : { toolCallId, status: "pending", rawInput: input ?? undefined }),
      })
      break
    }
    case "started": {
      sessionUpdate(session.sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "in_progress",
      })
      break
    }
    case "progress": {
      const preview = payload.outputPreview
      if (typeof preview === "string" && preview.length > 0) {
        pushToolContent(
          session,
          toolCallId,
          contentBlockText(preview.slice(0, 4000))
        )
      }
      break
    }
    case "result": {
      const result = payload.result
      const text =
        (result && (result.text ?? result.content ?? result.output)) ??
        (typeof result === "string" ? result : undefined)
      sessionUpdate(session.sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "success",
        ...(text !== undefined
          ? { content: [contentBlockText(String(text).slice(0, 20000))] }
          : {}),
        rawOutput: result ?? undefined,
      })
      break
    }
    case "error": {
      const message = payload.error?.message ?? "tool failed"
      sessionUpdate(session.sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        content: [contentBlockText(String(message).slice(0, 8000))],
      })
      break
    }
    default:
      break
  }
}

function modelValueOf(selection) {
  if (!selection) return null
  const providerId = selection.providerId ?? selection.ref?.providerId
  const modelId = selection.modelId ?? selection.ref?.modelId
  if (!providerId || !modelId) return null
  return `${providerId}/${modelId}`
}

function reasoningLevelOf(selection) {
  return selection?.options?.reasoningLevel ?? selection?.reasoningLevel ?? null
}

/** Absorb the model catalog from a `state.updated` patch
 * (`patch.model.available`, the same array the ZCode desktop renders). */
function applyModelCatalog(session, available, { emit = true } = {}) {
  if (!Array.isArray(available)) return
  session.modelsByValue = new Map()
  for (const model of available) {
    const value = modelValueOf(model)
    if (!value) continue
    const levels = (model?.reasoning?.levels ?? [])
      .map((level) =>
        typeof level === "string" ? level : (level?.value ?? level?.id ?? null)
      )
      .filter(Boolean)
    const contextWindow =
      typeof model?.contextWindow === "number" ? model.contextWindow : null
    session.modelsByValue.set(value, {
      name: model?.label ?? value,
      description: contextWindow
        ? `${Math.round(contextWindow / 1000)}K context`
        : undefined,
      levels,
    })
  }
  if (emit) session.emitConfigOptions()
}

function applyCurrentModel(session, selection, { emit = true } = {}) {
  const value = modelValueOf(selection)
  if (!value) return
  session.currentModel = {
    value,
    reasoningLevel: reasoningLevelOf(selection),
  }
  if (emit) session.emitConfigOptions()
}

/** Absorb the deterministic catalog carried by every session snapshot's
 * `settings` block (session/create and session/resume results) — no waiting
 * on push timing. `emit: false` while `session/new|load` is still in flight:
 * the host has no session yet, so a `config_option_update` push is dropped. */
function applySnapshotSettings(session, settings, { emit = true } = {}) {
  const model = settings?.model
  if (Array.isArray(model?.available)) {
    applyModelCatalog(session, model.available, { emit })
  }
  if (model?.current) {
    applyCurrentModel(session, model.current, { emit })
  }
  if (settings?.thoughtLevel?.current && session.currentModel) {
    session.currentModel = {
      ...session.currentModel,
      reasoningLevel: settings.thoughtLevel.current,
    }
    if (emit) session.emitConfigOptions()
  }
  const mode = settings?.mode?.current ?? settings?.permission?.mode
  if (mode) applyCurrentMode(session, mode, { emit })
}

function dispatchStateUpdated(params) {
  if (!params?.sessionId) return
  const session = sessions.get(params.sessionId)
  if (!session) return
  const patch = params.patch ?? {}
  // The model catalog rides the same patch as the mode snapshot; both the
  // catalog and the current selection feed the composer's Model/Reasoning
  // pickers (ACP config options).
  if (patch.model?.available) {
    applyModelCatalog(session, patch.model.available)
  }
  if (patch.model?.current) {
    applyCurrentModel(session, patch.model.current)
  } else if (patch.modelSelection) {
    applyCurrentModel(session, patch.modelSelection)
  }
  const mode = patch.mode?.current ?? patch.permission?.mode ?? patch.mode
  if (typeof mode === "string") applyCurrentMode(session, mode)
}

// ---------------------------------------------------------------------------
// Server -> client interaction requests (zcode side) -> ACP host
// ---------------------------------------------------------------------------

zcodeIncomingHandlers.set("session/requestRuntimePreferences", () => ({
  nativeSearchEnhancementsEnabled: false,
  memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: true,
  modelContextBudgetStrategy: "preflight-v1",
}))

zcodeIncomingHandlers.set(
  "interaction/requestProviderRuntimeHeaders",
  () => ({})
)

zcodeIncomingHandlers.set(
  "interaction/requestOfficialMcpAuthHeaders",
  async () => {
    throw new Error("zcode-acp does not supply official MCP auth headers")
  }
)

zcodeIncomingHandlers.set("interaction/requestPermission", async (params) => {
  const session = params?.sessionId ? sessions.get(params.sessionId) : undefined
  const options = Array.isArray(params?.options) ? params.options : []
  const acpOptions = []
  const optionById = new Map()
  for (const option of options) {
    const decision = option?.response?.decision
    let kind = "allow_once"
    if (decision === "deny") {
      kind = option?.kind === "always" ? "reject_always" : "reject_once"
    } else if (decision === "allow" || decision === "escalate") {
      kind = option?.kind === "always" ? "allow_always" : "allow_once"
    }
    const acpOption = {
      optionId: option.optionId,
      name: option.name ?? option.optionId,
      kind,
    }
    if (option.description)
      acpOption._meta = { description: option.description }
    acpOptions.push(acpOption)
    optionById.set(option.optionId, option)
  }
  if (acpOptions.length === 0) {
    return { decision: "deny", reason: "no options" }
  }

  // Seed the card so the permission UI shows the tool, not raw JSON.
  const toolCallId = params.toolCallId
  if (session && toolCallId && !session.seenToolCalls.has(toolCallId)) {
    session.seenToolCalls.add(toolCallId)
    sessionUpdate(session.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId,
      title: toolTitle(params.toolName, params.input),
      kind: classifyToolKind(params.toolName ?? ""),
      status: "pending",
      rawInput: params.input ?? undefined,
    })
  }

  const response = await acpRequest("session/request_permission", {
    sessionId: params.sessionId,
    toolCall: {
      toolCallId,
      title: toolTitle(params.toolName, params.input),
      kind: classifyToolKind(params.toolName ?? ""),
      rawInput: params.input ?? undefined,
    },
    options: acpOptions,
  })

  const outcome = response?.outcome ?? {}
  if (outcome.kind === "rejected" || outcome.kind === "cancelled") {
    return { decision: "deny", reason: "rejected by user" }
  }
  const chosen = optionById.get(outcome.optionId)
  if (!chosen?.response) {
    return { decision: "deny", reason: "unknown option" }
  }
  // A remembered allow can carry zcode's richer "always" semantics onward.
  return chosen.response
})

zcodeIncomingHandlers.set("interaction/requestUserInput", async (params) => {
  // ZCode's AskUserQuestion surface. Bridge multiple-choice questions as a
  // single-select ACP permission; free-text questions cannot be expressed in
  // ACP v1 and are answered as cancelled so the model can react gracefully.
  const choices = Array.isArray(params?.choices) ? params.choices : []
  if (choices.length === 0) {
    return { cancelled: true }
  }
  const options = choices.map((choice, index) => ({
    optionId: `choice-${index}`,
    name: String(choice),
    kind: "allow_once",
  }))
  try {
    const response = await acpRequest("session/request_permission", {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: params.requestId,
        title: params.prompt ?? "Question",
        kind: "other",
      },
      options,
    })
    const outcome = response?.outcome ?? {}
    if (
      outcome.kind !== "selected_once" &&
      outcome.kind !== "selected_always"
    ) {
      return { cancelled: true }
    }
    const index = Number(outcome.optionId?.slice("choice-".length))
    return { value: choices[index] }
  } catch {
    return { cancelled: true }
  }
})

// ---------------------------------------------------------------------------
// ACP method handlers (host side)
// ---------------------------------------------------------------------------

acpIncomingHandlers.set("initialize", async () => {
  const found = findZcodeEntry()
  if (!found) {
    const detail =
      "ZCode runtime not found. Install the ZCode desktop app or the zcode CLI, or set ZCODE_CLI."
    const error = new Error(detail)
    error.data = { hint: detail }
    throw error
  }
  // Do not run `zcode --version` here: it is a second full load of the 14MB
  // desktop bundle and blocks ACP Initialize (~0.5s) before app-server even
  // starts. Wait until app-server has written its first protocol frame so
  // session/new can proceed immediately after this returns.
  await ensureZcodeSpawned(found)
  return {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: {
        // Pasted images flow as ACP image blocks and are translated below
        // into zcode's inline dataBase64 attachments.
        image: true,
      },
    },
    authMethods: [],
    _meta: {
      zcodeEntry: found.entry,
      zcodeEntrySource: found.via,
    },
    agentInfo: {
      name: "ZCode",
      version: "runtime",
    },
  }
})

// The desktop host injects these paths when IT spawns app-server workers; a
// bare `zcode app-server` does not resolve them itself, and without the
// built-in file the provider registry cannot resolve template-based
// providers (every model becomes "Model not found"). Mirror the CLI's own
// resolution order from `prepareCliProviderRuntimeEnv`.
function providerRuntimeEnv(entry) {
  const env = {}
  const home = homedir()
  const personal = join(home, ".zcode", "v2", "provider_config.json")
  if (process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE?.trim()) {
    env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE =
      process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE.trim()
  } else {
    env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = personal
  }
  const explicitBuiltin = process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE?.trim()
  if (explicitBuiltin) {
    env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = explicitBuiltin
    return env
  }
  // Materialized endpoint cache (what the CLI keeps fresh on disk).
  const runtimeRoot = join(home, ".zcode", "v2", "runtime", "provider")
  const cached = []
  if (existsSync(runtimeRoot)) {
    try {
      for (const platformDir of readdirSync(runtimeRoot)) {
        const platformRoot = join(runtimeRoot, platformDir)
        for (const versionDir of readdirSync(platformRoot)) {
          const versionRoot = join(platformRoot, versionDir)
          for (const endpointDir of readdirSync(versionRoot)) {
            const candidate = join(
              versionRoot,
              endpointDir,
              "zcode-builtin.json"
            )
            if (existsSync(candidate)) cached.push(candidate)
          }
        }
      }
    } catch {
      // fall through to the bundled candidates below
    }
  }
  cached.sort()
  const bundled = [
    join(dirname(entry), "..", "config", "provider", "zcode-builtin.json"),
    join(
      dirname(entry),
      "..",
      "..",
      "..",
      "..",
      "..",
      "config",
      "provider",
      "zcode-builtin.json"
    ),
  ].map((candidate) => resolve(candidate))
  const builtin = [...cached.reverse(), ...bundled].find((candidate) =>
    existsSync(candidate)
  )
  if (builtin) env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtin
  return env
}

let zcodeSpawnPromise = null
let zcodeReadyPromise = null
let settleZcodeReady = null

function beginZcodeReadyWait() {
  zcodeReadyPromise = new Promise((resolve, reject) => {
    settleZcodeReady = { resolve, reject }
  })
}

function markZcodeReady() {
  settleZcodeReady?.resolve()
  settleZcodeReady = null
}

const ZCODE_READY_TIMEOUT_MS = 20000

async function ensureZcodeSpawned(found) {
  if (!zcodeSpawnPromise) {
    beginZcodeReadyWait()
    zcodeSpawnPromise = (async () => {
      const [command, ...baseArgs] = zcodeCommandFor(found.entry)
      const providerEnv = providerRuntimeEnv(found.entry)
      const child = spawn(command, [...baseArgs, "app-server", "--stdio"], {
        cwd: homedir(),
        env: { ...process.env, ...providerEnv, NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      })
      wireZcodeChild(child)
    })().catch((error) => {
      zcodeSpawnPromise = null
      settleZcodeReady?.reject(error)
      settleZcodeReady = null
      throw error
    })
  }
  await zcodeSpawnPromise
  if (!zcodeReadyPromise) return
  let timer
  try {
    await Promise.race([
      zcodeReadyPromise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("zcode app-server did not become ready")),
          ZCODE_READY_TIMEOUT_MS
        )
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function wireZcodeChild(child) {
  zcodeChild = child
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    zcodeBuffer += chunk
    let newlineIndex
    while ((newlineIndex = zcodeBuffer.indexOf("\n")) >= 0) {
      const line = zcodeBuffer.slice(0, newlineIndex).trim()
      zcodeBuffer = zcodeBuffer.slice(newlineIndex + 1)
      if (!line) continue
      const message = jsonParse(line, null)
      if (message) {
        markZcodeReady()
        handleZcodeMessage(message)
      } else log(`unparseable zcode frame: ${line.slice(0, 200)}`)
    }
  })
  child.stdout.on("end", () => rejectAllZcodePending("zcode stdout closed"))
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.split("\n")) {
      if (line.trim()) log(`[zcode] ${line}`)
    }
  })
  child.on("exit", (code, signal) => {
    log(`zcode app-server exited code=${code} signal=${signal}`)
    rejectAllZcodePending("zcode app-server exited")
    settleZcodeReady?.reject(new Error("zcode app-server exited"))
    settleZcodeReady = null
    for (const session of sessions.values()) {
      sessionUpdate(session.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: contentBlockText("_ZCode runtime exited._"),
      })
      session.resolvePrompt("end_turn")
    }
    zcodeChild = null
    zcodeSpawnPromise = null
    zcodeReadyPromise = null
  })
}

function rejectAllZcodePending(reason) {
  for (const pending of zcodePending.values()) {
    pending.reject(new Error(reason))
  }
  zcodePending.clear()
}

acpIncomingHandlers.set("authenticate", async () => ({}))

acpIncomingHandlers.set("session/new", async (params) => {
  const cwd = params?.cwd ?? homedir()
  const modelOverride = parseModelOverride()
  const createParams = {
    workspace: workspaceRefFor(cwd),
    mode: initialZcodeMode(),
    ...(modelOverride ? { model: modelOverride } : {}),
    ...(mapMcpServers(params?.mcpServers)
      ? { mcpServers: mapMcpServers(params.mcpServers) }
      : {}),
  }
  const created = await zcodeRequest("session/create", createParams)
  const sessionId = created?.session?.sessionId
  if (!sessionId) {
    throw new Error("zcode session/create returned no sessionId")
  }
  sessions.set(sessionId, new SessionState(sessionId, cwd))
  await zcodeRequest("session/subscribe", {
    sessionId,
    deliveryKind: "desktop-continuous",
  })
  // The create result is a full session snapshot whose `settings` block
  // carries the model catalog deterministically. Reading it here puts the
  // composer's pickers (Model / Reasoning) into the session/new response
  // itself — how codex-acp does it; pushes sent before the host finishes
  // session/new would land on a connection with no session state and be
  // dropped. The post-establishment `config_option_update` stream keeps the
  // pickers in sync after live switches.
  const session = sessions.get(sessionId)
  applySnapshotSettings(session, created?.settings, { emit: false })
  const catalog = session.configOptions()
  return {
    sessionId,
    modes: sessionModesState(session.currentMode),
    ...(catalog.length > 0 ? { configOptions: catalog } : {}),
    _meta: { zcodeSessionId: sessionId },
  }
})

acpIncomingHandlers.set("session/load", async (params) => {
  const sessionId = params?.sessionId
  if (!sessionId) throw new Error("session/load requires sessionId")
  const cwd = params?.cwd ?? homedir()
  const resumed = await zcodeRequest("session/resume", {
    sessionId,
    workspace: workspaceRefFor(cwd),
    ...(mapMcpServers(params?.mcpServers)
      ? { mcpServers: mapMcpServers(params.mcpServers) }
      : {}),
  })
  const session = new SessionState(sessionId, cwd)
  sessions.set(sessionId, session)
  await zcodeRequest("session/subscribe", {
    sessionId,
    deliveryKind: "desktop-continuous",
  })
  applySnapshotSettings(session, resumed?.settings, { emit: false })
  const resumeCatalog = session.configOptions()
  const replay = await zcodeRequest(
    "session/events",
    { sessionId, afterSeq: 0 },
    60000
  ).catch(() => null)
  if (replay && Array.isArray(replay.events)) {
    for (const event of replay.events) {
      // Replay through the same mapping the live path uses; terminal turn
      // events are skipped because no prompt is in flight during replay.
      if (event?.type === "turn.completed" || event?.type === "turn.failed")
        continue
      dispatchSessionEvent(event)
    }
  }
  return {
    sessionId: resumed?.session?.sessionId ?? sessionId,
    modes: sessionModesState(session.currentMode),
    ...(resumeCatalog.length > 0 ? { configOptions: resumeCatalog } : {}),
    _meta: { zcodeSessionId: sessionId, resumed: true },
  }
})

acpIncomingHandlers.set("session/prompt", async (params) => {
  const sessionId = params?.sessionId
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`unknown session: ${sessionId}`)
  const blocks = Array.isArray(params?.prompt) ? params.prompt : []
  const text = blocks
    .map((block) => {
      if (block?.type === "text" && typeof block.text === "string")
        return block.text
      if (block?.type === "resource_link") return block.uri ?? ""
      return ""
    })
    .filter(Boolean)
    .join("\n")
  // ACP image blocks -> zcode's inline attachment payload
  // (kind/dataBase64/filename/mimeType; see mapProtocolPromptAttachment in
  // the zcode server, which turns dataBase64 into a data: URL for the
  // runtime — no temp file needed).
  const imageBlocks = blocks.filter(
    (block) => block?.type === "image" && typeof block.data === "string"
  )
  const attachments = imageBlocks.map((block, index) => {
    const mimeType =
      typeof block.mimeType === "string" && block.mimeType
        ? block.mimeType
        : "image/png"
    const extension = mimeType.split("/")[1]?.split(";")[0] || "png"
    return {
      kind: "image",
      dataBase64: block.data,
      mimeType,
      filename:
        typeof block.fileName === "string" && block.fileName
          ? block.fileName
          : `image-${index + 1}.${extension}`,
      sizeBytes: Math.floor((block.data.length * 3) / 4),
    }
  })
  if (!text && attachments.length === 0) {
    return { stopReason: "end_turn" }
  }
  // Deliberately NO modelSelection here: the session's current selection
  // (set at create from ZCODE_MODEL, or switched live through the composer's
  // Model picker via session/setModel) owns every turn. Re-sending the env
  // override would fight that picker and silently flip turns back.
  return new Promise((resolvePrompt) => {
    if (process.env.ZCODE_ACP_DEBUG === "1") log("prompt resolver installed")
    session.promptResolver = resolvePrompt
    zcodeRequest(
      "session/send",
      {
        sessionId,
        content: text,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      0
    ).catch((error) => {
      sessionUpdate(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: contentBlockText(`_Failed to send: ${error.message}_`),
      })
      session.resolvePrompt("end_turn")
    })
  })
})

acpIncomingHandlers.set("session/cancel", async (params) => {
  const sessionId = params?.sessionId
  const session = sessions.get(sessionId)
  if (!session) return
  try {
    await zcodeRequest("session/stop", { sessionId }, 15000)
    // The aborted turn surfaces as a turn.failed event which resolves the
    // prompt; fall through in case events are delayed.
  } catch (error) {
    log(`session/stop failed: ${error.message}`)
  }
  // ACP requires the cancelled reply even when the runtime is slow to
  // confirm; resolve locally if the event has not done it yet.
  setTimeout(() => {
    if (session.promptResolver) {
      sessionUpdate(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: contentBlockText("_Turn cancelled._"),
      })
      session.resolvePrompt("cancelled")
    }
  }, 500).unref?.()
})

acpIncomingHandlers.set("session/set_mode", async (params) => {
  const sessionId = params?.sessionId
  const session = sessionId ? sessions.get(sessionId) : undefined
  if (!session) throw new Error("session/set_mode requires a live session")
  const requested = params?.modeId ?? params?.mode
  if (requested == null || requested === "") {
    throw new Error("session/set_mode requires modeId")
  }
  if (!ZCODE_MODE_IDS.has(requested) && requested !== "auto") {
    throw new Error(`unknown zcode mode: ${requested}`)
  }
  const mode = normalizeZcodeMode(requested)
  await zcodeRequest("session/setMode", { sessionId, mode })
  applyCurrentMode(session, mode)
  return {}
})

acpIncomingHandlers.set("session/set_config_option", async (params) => {
  const sessionId = params?.sessionId
  const session = sessions.get(sessionId)
  if (!session) throw new Error(`unknown session: ${sessionId}`)
  const configId = params?.configId
  const value =
    typeof params?.value === "string"
      ? params.value
      : (params?.value?.value ?? params?.value)

  if (configId === "mode") {
    if (value == null || value === "") {
      throw new Error("mode requires a value")
    }
    if (!ZCODE_MODE_IDS.has(value) && value !== "auto") {
      throw new Error(`unknown zcode mode: ${value}`)
    }
    const mode = normalizeZcodeMode(value)
    await zcodeRequest("session/setMode", { sessionId, mode })
    applyCurrentMode(session, mode)
    return { configOptions: session.configOptions() }
  }

  if (configId === "model") {
    const entry = session.modelsByValue.get(value)
    if (!entry) {
      throw new Error(`unknown model: ${value}`)
    }
    const [providerId, ...rest] = value.split("/")
    const modelId = rest.join("/")
    // GLM-style models reject a selection without a reasoning level; carry
    // the current level over when the new model supports it, else take its
    // first supported level.
    let reasoningLevel = session.currentModel?.reasoningLevel
    if (
      !reasoningLevel ||
      (entry.levels.length > 0 && !entry.levels.includes(reasoningLevel))
    ) {
      reasoningLevel = entry.levels[0] ?? null
    }
    await zcodeRequest("session/setModel", {
      sessionId,
      model: {
        providerId,
        modelId,
        ...(reasoningLevel ? { options: { reasoningLevel } } : {}),
      },
    })
    session.currentModel = { value, reasoningLevel }
    session.emitConfigOptions()
    return { configOptions: session.configOptions() }
  }

  if (configId === "reasoning") {
    await zcodeRequest("session/setThoughtLevel", {
      sessionId,
      thoughtLevel: value,
    })
    if (session.currentModel) {
      session.currentModel = { ...session.currentModel, reasoningLevel: value }
    }
    session.emitConfigOptions()
    return { configOptions: session.configOptions() }
  }

  throw new Error(`unknown config option: ${configId}`)
})

// fs/* : the zcode runtime performs its own file IO in the session cwd; the
// adapter never asks the host for files.
acpIncomingHandlers.set("fs/read_text_file", async () => {
  throw new Error("zcode-acp does not use host filesystem access")
})

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  stdoutBuffer += chunk
  let newlineIndex
  while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.slice(0, newlineIndex).trim()
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
    if (!line) continue
    const message = jsonParse(line, null)
    if (!message || message.jsonrpc !== JSONRPC) {
      log(`dropping non-jsonrpc frame: ${line.slice(0, 200)}`)
      continue
    }
    if ("id" in message && "method" in message) {
      const handler = acpIncomingHandlers.get(message.method)
      if (!handler) {
        acpRespondError(
          message.id,
          -32601,
          `method not found: ${message.method}`
        )
        continue
      }
      Promise.resolve(handler(message.params ?? {}))
        .then((result) => acpRespond(message.id, result ?? {}))
        .catch((error) =>
          acpRespondError(message.id, -32000, error?.message ?? String(error))
        )
    } else if ("id" in message) {
      const pending = acpPending.get(message.id)
      if (pending) {
        acpPending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
      }
    }
    // Notifications from the host are ignored.
  }
})
process.stdin.on("end", () => {
  log("stdin closed; shutting down")
  if (zcodeChild && !zcodeChild.killed) {
    zcodeChild.stdin?.end()
    setTimeout(() => zcodeChild?.kill(), 1500).unref?.()
  }
  setTimeout(() => process.exit(0), 2000).unref?.()
})

process.on("uncaughtException", (error) => {
  log(`uncaught exception: ${error?.stack ?? error}`)
})

// Start app-server as soon as this adapter process exists, so Initialize
// mostly waits for a runtime that is already booting rather than starting
// the 14MB bundle from cold.
{
  const found = findZcodeEntry()
  if (found) {
    ensureZcodeSpawned(found).catch((error) =>
      log(`eager spawn failed: ${error?.message ?? error}`)
    )
  }
}
