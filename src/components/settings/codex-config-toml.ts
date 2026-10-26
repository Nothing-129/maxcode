import { parse as parseTomlDocument } from "smol-toml"

interface CodexTomlImportantValues {
  model: string
  modelProvider: string
  providerNames: string[]
  providerBaseUrls: Record<string, string>
  providerSupportsWebsockets: Record<string, boolean>
  featureResponsesWebsocketsV2: boolean
  featureSkills: boolean
  featureDefaultModeRequestUserInput: boolean
  serviceTierFast: boolean
}

export const CODEX_DEFAULT_MODEL_PROVIDER = "codeg"

/**
 * `[features]` flag that lets codex call its `request_user_input` tool in the
 * DEFAULT collaboration mode.
 *
 * Upstream, `ModeKind::allows_request_user_input()` is true for `Plan` only
 * (codex-rs/protocol/src/config_types.rs), and
 * `request_user_input_available_modes()` widens it to `Default` exactly when
 * this feature is on (codex-rs/tools/src/tool_config.rs). Without it a
 * default-mode turn that reaches for the tool is refused with
 * "request_user_input is unavailable in Default mode" — i.e. codeg's question
 * cards only ever appear in Plan mode (openai/codex#24750).
 *
 * Stage is `UnderDevelopment` and `default_enabled` is false
 * (codex-rs/features/src/lib.rs), so it has no `/experimental` menu entry and
 * config.toml is the only way to turn it on. Verified against codex-cli 0.147.0
 * — the version codeg's pinned codex-acp 1.4.0 depends on — with
 * `codex features list`: absent ⇒ false, `= true` ⇒ true. Unknown keys under
 * `[features]` are ignored rather than rejected (also verified), so writing it
 * is safe on a codex build that predates the flag.
 */
export const CODEX_DEFAULT_MODE_REQUEST_USER_INPUT_KEY =
  "default_mode_request_user_input"

/**
 * Header codex reads to decide whether a provider authenticates through the
 * "actor authorization" path. Mirrors `OPENAI_ACTOR_AUTHORIZATION_HEADER` in
 * codex's `model-provider-info` crate.
 */
const CODEX_ACTOR_AUTHORIZATION_HEADER = "x-openai-actor-authorization"

function parseTomlStringLiteral(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  if (text.startsWith('"')) {
    let escaped = false
    for (let i = 1; i < text.length; i += 1) {
      const ch = text[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === '"') {
        const literal = text.slice(0, i + 1)
        try {
          return JSON.parse(literal) as string
        } catch {
          return literal.slice(1, -1)
        }
      }
    }
    return null
  }

  if (text.startsWith("'")) {
    const end = text.indexOf("'", 1)
    if (end <= 0) return null
    return text.slice(1, end)
  }

  return null
}

function parseTomlStringAssignment(
  rawLine: string
): { key: string; value: string } | null {
  const key = parseTomlAssignmentKey(rawLine)
  if (!key) return null
  const line = rawLine.trim()
  const equalsIndex = line.indexOf("=")
  const valueText = line.slice(equalsIndex + 1)
  const value = parseTomlStringLiteral(valueText)
  if (value === null) return null
  return { key, value: value.trim() }
}

function parseTomlAssignmentKey(rawLine: string): string | null {
  const line = rawLine.trim()
  if (!line || line.startsWith("#")) return null
  const equalsIndex = line.indexOf("=")
  if (equalsIndex <= 0) return null
  const key = line.slice(0, equalsIndex).trim()
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) return null
  return key
}

function parseTomlBooleanAssignment(
  rawLine: string
): { key: string; value: boolean } | null {
  const key = parseTomlAssignmentKey(rawLine)
  if (!key) return null
  const line = rawLine.trim()
  const equalsIndex = line.indexOf("=")
  const valueText = line.slice(equalsIndex + 1).trim()
  const boolMatch = valueText.match(/^(true|false)(?:\s+#.*)?$/)
  if (!boolMatch) return null
  return { key, value: boolMatch[1] === "true" }
}

export function extractCodexTomlImportantValues(
  configTomlText: string
): CodexTomlImportantValues {
  const providerBaseUrls: Record<string, string> = {}
  const providerSupportsWebsockets: Record<string, boolean> = {}
  const providerNames = new Set<string>()
  let model = ""
  let modelProvider = ""
  let featureResponsesWebsocketsV2 = false
  let featureSkills = false
  let featureDefaultModeRequestUserInput = false
  let serviceTierFast = false
  let currentProviderSection: string | null = null
  let inFeaturesSection = false
  // Still above the first section header, i.e. in the implicit root table —
  // the only place a dotted `features.x` key actually means `[features].x`.
  let inRootTable = true

  for (const rawLine of configTomlText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    // Section tracking goes through the same header predicate the writer uses,
    // so the two never disagree about where a table begins. A header carrying
    // a trailing comment (`[features] # flags`) is a header.
    const headerName = tomlSectionHeaderName(rawLine)
    if (isTomlSectionHeader(rawLine)) {
      inRootTable = false
      const providerName = headerName?.match(
        /^model_providers\.([A-Za-z0-9_-]+)$/
      )?.[1]
      if (providerName) {
        currentProviderSection = providerName
        inFeaturesSection = false
        providerNames.add(providerName)
      } else {
        currentProviderSection = null
        inFeaturesSection = headerName === "features"
      }
      continue
    }

    const assignment = parseTomlStringAssignment(rawLine)
    if (assignment) {
      if (assignment.key === "model") {
        model = assignment.value
        continue
      }
      if (assignment.key === "model_provider") {
        modelProvider = assignment.value
        continue
      }
      if (
        !currentProviderSection &&
        !inFeaturesSection &&
        assignment.key === "service_tier"
      ) {
        serviceTierFast = assignment.value.toLowerCase() === "fast"
        continue
      }
    }

    const boolAssignment = parseTomlBooleanAssignment(rawLine)
    if (boolAssignment) {
      if (
        currentProviderSection &&
        boolAssignment.key === "supports_websockets"
      ) {
        providerSupportsWebsockets[currentProviderSection] =
          boolAssignment.value
        providerNames.add(currentProviderSection.trim())
        continue
      }
      if (
        inFeaturesSection &&
        boolAssignment.key === "responses_websockets_v2"
      ) {
        featureResponsesWebsocketsV2 = boolAssignment.value
        continue
      }
      if (inFeaturesSection && boolAssignment.key === "skills") {
        featureSkills = boolAssignment.value
        continue
      }
      if (
        inFeaturesSection &&
        boolAssignment.key === CODEX_DEFAULT_MODE_REQUEST_USER_INPUT_KEY
      ) {
        featureDefaultModeRequestUserInput = boolAssignment.value
        continue
      }
      const dottedProviderWebsocketMatch = boolAssignment.key.match(
        /^model_providers\.([A-Za-z0-9_-]+)\.supports_websockets$/
      )
      if (dottedProviderWebsocketMatch && dottedProviderWebsocketMatch[1]) {
        const providerName = dottedProviderWebsocketMatch[1].trim()
        providerNames.add(providerName)
        providerSupportsWebsockets[providerName] = boolAssignment.value
        continue
      }
      // The three dotted `features.*` spellings below are ROOT-scoped on
      // purpose. Inside `[model_providers.codeg]` the same text means
      // `model_providers.codeg.features.…` — a key codex ignores — and the
      // writer only ever touches the root spelling. Reading a nested one would
      // show a value no save could clear, and (for the websocket flag, which
      // the writer re-derives on every patch) would promote a provider-local
      // key into a global `[features]` flag behind the user's back.
      if (inRootTable) {
        if (boolAssignment.key === "features.responses_websockets_v2") {
          featureResponsesWebsocketsV2 = boolAssignment.value
          continue
        }
        if (boolAssignment.key === "features.skills") {
          featureSkills = boolAssignment.value
          continue
        }
        if (
          boolAssignment.key ===
          `features.${CODEX_DEFAULT_MODE_REQUEST_USER_INPUT_KEY}`
        ) {
          featureDefaultModeRequestUserInput = boolAssignment.value
          continue
        }
      }
    }

    if (!assignment) continue

    const rawAssignmentKey = parseTomlAssignmentKey(rawLine)
    const dottedProviderMatch = rawAssignmentKey?.match(
      /^model_providers\.([A-Za-z0-9_-]+)\./
    )
    if (dottedProviderMatch && dottedProviderMatch[1]) {
      providerNames.add(dottedProviderMatch[1].trim())
    }
    if (
      currentProviderSection &&
      assignment.key === "base_url" &&
      assignment.value
    ) {
      providerBaseUrls[currentProviderSection] = assignment.value
      providerNames.add(currentProviderSection.trim())
      continue
    }
    const dottedMatch = assignment.key.match(
      /^model_providers\.([A-Za-z0-9_-]+)\.base_url$/
    )
    if (dottedMatch && assignment.value) {
      providerBaseUrls[dottedMatch[1]] = assignment.value
      providerNames.add(dottedMatch[1].trim())
    }
  }
  if (modelProvider.trim()) {
    providerNames.add(modelProvider.trim())
  }
  providerNames.add(CODEX_DEFAULT_MODEL_PROVIDER)
  for (const providerName of Object.keys(providerBaseUrls)) {
    if (providerName.trim()) {
      providerNames.add(providerName.trim())
    }
  }

  return {
    model,
    modelProvider,
    providerNames: Array.from(providerNames),
    providerBaseUrls,
    providerSupportsWebsockets,
    featureResponsesWebsocketsV2,
    featureSkills,
    featureDefaultModeRequestUserInput,
    serviceTierFast,
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Whether a line opens a new TOML table — `[table]` or `[[array]]` — allowing
 * the trailing comment TOML permits after a header. Matching `[x]` exactly
 * (what these helpers used to do) makes `[features] # flags` invisible, which
 * is not a cosmetic miss: the scanner then keeps treating the lines below it as
 * root-table keys, so an upsert appends a SECOND `[features]` and the file
 * stops parsing.
 */
function isTomlSectionHeader(rawLine: string): boolean {
  const line = rawLine.trim()
  return line.startsWith("[") && /^\[.*\]\s*(?:#.*)?$/.test(line)
}

/**
 * The table name from a `[table]` header, or null for anything else —
 * including `[[array]]`, which is not a plain table. Surrounding whitespace is
 * insignificant in TOML (`[ features ]` names `features`), so it is trimmed.
 */
function tomlSectionHeaderName(rawLine: string): string | null {
  const match = rawLine.trim().match(/^\[([^[\]]*)\]\s*(?:#.*)?$/)
  return match ? match[1].trim() : null
}

function findTomlRootEndIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (isTomlSectionHeader(lines[i])) return i
  }
  return lines.length
}

function findTomlRootAssignmentIndex(lines: string[], key: string): number {
  const rootEnd = findTomlRootEndIndex(lines)
  for (let i = 0; i < rootEnd; i += 1) {
    const assignmentKey = parseTomlAssignmentKey(lines[i])
    if (assignmentKey === key) return i
  }
  return -1
}

function preferredTomlRootInsertionIndex(lines: string[], key: string): number {
  if (key === "model") {
    const providerIndex = findTomlRootAssignmentIndex(lines, "model_provider")
    return providerIndex >= 0 ? providerIndex : 0
  }
  let insertAt = findTomlRootEndIndex(lines)
  while (insertAt > 0 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1
  }
  return insertAt
}

export function updateTomlRootStringKey(
  configTomlText: string,
  key: string,
  value: string
): string {
  const lineText = `${key} = ${JSON.stringify(value)}`
  const lines = configTomlText.split(/\r?\n/)
  const assignmentIndex = findTomlRootAssignmentIndex(lines, key)

  const nextValue = value.trim()
  if (!nextValue) {
    if (assignmentIndex >= 0) {
      lines.splice(assignmentIndex, 1)
    }
    return lines.join("\n").trim()
  }

  const insertAt = preferredTomlRootInsertionIndex(lines, key)
  if (assignmentIndex >= 0) {
    lines[assignmentIndex] = lineText
  } else {
    lines.splice(Math.max(0, insertAt), 0, lineText)
  }
  return lines.join("\n").trim()
}

export function updateTomlRootBooleanKey(
  configTomlText: string,
  key: string,
  value: boolean
): string {
  const lineText = `${key} = ${value ? "true" : "false"}`
  const lines = configTomlText.split(/\r?\n/)
  const assignmentIndex = findTomlRootAssignmentIndex(lines, key)
  if (assignmentIndex >= 0) {
    lines[assignmentIndex] = lineText
  } else {
    lines.splice(0, 0, lineText)
  }
  return lines.join("\n").trim()
}

function findTomlSectionRange(
  lines: string[],
  sectionName: string
): { start: number; end: number } | null {
  let sectionStart = -1
  let sectionEnd = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    if (sectionStart < 0) {
      if (tomlSectionHeaderName(lines[i]) === sectionName) {
        sectionStart = i
      }
      continue
    }
    if (isTomlSectionHeader(lines[i])) {
      sectionEnd = i
      break
    }
  }
  if (sectionStart < 0) return null
  return { start: sectionStart, end: sectionEnd }
}

export function removeTomlSection(
  configTomlText: string,
  sectionName: string
): string {
  const lines = configTomlText.split(/\r?\n/)
  const range = findTomlSectionRange(lines, sectionName)
  if (!range) return configTomlText
  // Remove blank line before section header if present
  const removeStart =
    range.start > 0 && lines[range.start - 1].trim() === ""
      ? range.start - 1
      : range.start
  lines.splice(removeStart, range.end - removeStart)
  return lines.join("\n").trim()
}

/**
 * Drop any ROOT-level `<section>.<key> = …` line — the dotted spelling of the
 * very key this upsert is about to write into `[section]`.
 *
 * TOML treats `features.skills = true` and `[features]` + `skills = true` as
 * the same key, but they cannot coexist: the dotted form defines the `features`
 * table implicitly, so a later `[features]` header is a hard
 * "trying to redefine an already defined table" parse error. Leaving the dotted
 * line in place therefore breaks both directions — turning the switch OFF would
 * not remove the value the reader still sees (the control snaps back), and
 * turning it ON would emit a config.toml the backend refuses to persist.
 *
 * Only lines above the FIRST section header are considered: inside
 * `[model_providers.codeg]`, `features.skills` means
 * `model_providers.codeg.features.skills`, an unrelated key we must not touch.
 */
function stripRootDottedKey(
  lines: string[],
  sectionName: string,
  key: string
): void {
  const dotted = `${sectionName}.${key}`
  for (let i = 0; i < lines.length; i += 1) {
    if (isTomlSectionHeader(lines[i])) return
    if (parseTomlAssignmentKey(lines[i]) === dotted) {
      lines.splice(i, 1)
      i -= 1
    }
  }
}

/**
 * Index of the last ROOT-level `<section>.…` dotted assignment, or -1.
 *
 * A surviving sibling means the root table already defines `[section]`
 * implicitly, so emitting a `[section]` header would be a redefinition. Writing
 * the new key in the same dotted spelling keeps the document valid and leaves
 * the sibling — someone else's setting — exactly where the user put it.
 */
function lastRootDottedSiblingIndex(
  lines: string[],
  sectionName: string
): number {
  const prefix = `${sectionName}.`
  let last = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (isTomlSectionHeader(lines[i])) break
    if (parseTomlAssignmentKey(lines[i])?.startsWith(prefix)) last = i
  }
  return last
}

function upsertTomlSectionBooleanKey(
  configTomlText: string,
  sectionName: string,
  key: string,
  value: boolean | null
): string {
  const lines = configTomlText.split(/\r?\n/)
  stripRootDottedKey(lines, sectionName, key)
  const section = findTomlSectionRange(lines, sectionName)

  if (section) {
    let assignmentIndex = -1
    for (let i = section.start + 1; i < section.end; i += 1) {
      const assignmentKey = parseTomlAssignmentKey(lines[i])
      if (assignmentKey === key) {
        assignmentIndex = i
        break
      }
    }

    if (value === null) {
      if (assignmentIndex >= 0) {
        lines.splice(assignmentIndex, 1)
      }
      const refreshedSection = findTomlSectionRange(lines, sectionName)
      if (refreshedSection) {
        const hasEntries = lines
          .slice(refreshedSection.start + 1, refreshedSection.end)
          .some((rawLine) => {
            const line = rawLine.trim()
            return line !== "" && !line.startsWith("#")
          })
        if (!hasEntries) {
          const before = lines.slice(0, refreshedSection.start)
          const after = lines.slice(refreshedSection.end)
          while (before.length > 0 && before[before.length - 1].trim() === "") {
            before.pop()
          }
          while (after.length > 0 && after[0].trim() === "") {
            after.shift()
          }
          const merged =
            before.length > 0 && after.length > 0
              ? [...before, "", ...after]
              : [...before, ...after]
          return merged.join("\n").trim()
        }
      }
      return lines.join("\n").trim()
    }

    const lineText = `${key} = ${value ? "true" : "false"}`
    if (assignmentIndex >= 0) {
      lines[assignmentIndex] = lineText
    } else {
      let insertAt = section.end
      for (let i = section.end - 1; i > section.start; i -= 1) {
        if (lines[i].trim() !== "") {
          insertAt = i + 1
          break
        }
      }
      lines.splice(insertAt, 0, lineText)
    }
    return lines.join("\n").trim()
  }

  // No `[section]` to edit. Removing is still not a no-op: a root-level dotted
  // spelling of this key may have just been stripped above, and that IS the
  // value the reader was showing.
  if (value === null) {
    return lines.join("\n").trim()
  }

  const lineText = `${key} = ${value ? "true" : "false"}`

  // The root table may already define this section through a dotted sibling we
  // must not touch (`features.skills = true` while we write
  // `features.default_mode_request_user_input`). Join it in its own spelling
  // rather than opening a header that would redefine the table.
  const sibling = lastRootDottedSiblingIndex(lines, sectionName)
  if (sibling >= 0) {
    lines.splice(sibling + 1, 0, `${sectionName}.${lineText}`)
    return lines.join("\n").trim()
  }

  const insertAt = findTomlRootEndIndex(lines)
  const prefixBlank =
    insertAt > 0 && lines[insertAt - 1].trim() !== "" ? [""] : []
  const suffixBlank =
    insertAt < lines.length && lines[insertAt].trim() !== "" ? [""] : []
  lines.splice(
    insertAt,
    0,
    ...prefixBlank,
    `[${sectionName}]`,
    lineText,
    ...suffixBlank
  )
  return lines.join("\n").trim()
}

function patchCodexProviderBaseUrl(
  configTomlText: string,
  provider: string,
  apiBaseUrl: string
): string {
  const trimmedProvider = provider.trim()
  if (!trimmedProvider) return configTomlText.trim()

  const nextApiBaseUrl = apiBaseUrl.trim()
  const lines = configTomlText.split(/\r?\n/)
  const sectionPattern = new RegExp(
    `^\\[\\s*model_providers\\.${escapeRegExp(trimmedProvider)}\\s*\\]$`
  )
  let sectionStart = -1
  let sectionEnd = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (sectionStart < 0) {
      if (sectionPattern.test(trimmed)) {
        sectionStart = i
      }
      continue
    }
    if (/^\[.*\]$/.test(trimmed)) {
      sectionEnd = i
      break
    }
  }

  if (sectionStart >= 0) {
    let baseUrlIndex = -1
    for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
      const assignment = parseTomlStringAssignment(lines[i])
      if (!assignment || assignment.key !== "base_url") continue
      baseUrlIndex = i
      break
    }
    if (!nextApiBaseUrl) {
      if (baseUrlIndex >= 0) {
        lines.splice(baseUrlIndex, 1)
      }
      return lines.join("\n").trim()
    }

    const lineText = `base_url = ${JSON.stringify(nextApiBaseUrl)}`
    if (baseUrlIndex >= 0) {
      lines[baseUrlIndex] = lineText
    } else {
      lines.splice(sectionEnd, 0, lineText)
    }
    return lines.join("\n").trim()
  }

  if (!nextApiBaseUrl) return configTomlText.trim()

  const appended = configTomlText.trimEnd()
  const sectionText = `[model_providers.${trimmedProvider}]\nbase_url = ${JSON.stringify(nextApiBaseUrl)}`
  if (!appended) return sectionText
  return `${appended}\n\n${sectionText}`.trim()
}

function patchCodexProviderField(
  configTomlText: string,
  provider: string,
  key: string,
  lineText: string
): string {
  const trimmedProvider = provider.trim()
  if (!trimmedProvider) return configTomlText.trim()

  const lines = configTomlText.split(/\r?\n/)
  const sectionPattern = new RegExp(
    `^\\[\\s*model_providers\\.${escapeRegExp(trimmedProvider)}\\s*\\]$`
  )
  let sectionStart = -1
  let sectionEnd = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (sectionStart < 0) {
      if (sectionPattern.test(trimmed)) {
        sectionStart = i
      }
      continue
    }
    if (/^\[.*\]$/.test(trimmed)) {
      sectionEnd = i
      break
    }
  }

  if (sectionStart >= 0) {
    let fieldIndex = -1
    for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
      const assignmentKey = parseTomlAssignmentKey(lines[i])
      if (assignmentKey !== key) continue
      fieldIndex = i
      break
    }
    if (fieldIndex >= 0) {
      lines[fieldIndex] = lineText
    } else {
      let insertAt = sectionEnd
      while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === "") {
        insertAt -= 1
      }
      lines.splice(insertAt, 0, lineText)
    }
    return lines.join("\n").trim()
  }

  const appended = configTomlText.trimEnd()
  const sectionText = `[model_providers.${trimmedProvider}]\n${lineText}`
  if (!appended) return sectionText
  return `${appended}\n\n${sectionText}`.trim()
}

/**
 * Result of reading `[model_providers.<provider>]` out of a config.toml draft.
 * "table absent" and "document unparsable" are deliberately distinct: an absent
 * table is a brand-new provider we should seed, a document we cannot parse is
 * one we must not touch.
 */
type CodexProviderTableRead =
  | { status: "ok"; table: Record<string, unknown> | null }
  | { status: "unparsable" }

/**
 * Read-only view of one provider table. Every *write* in this file stays
 * text-based so user comments and key order survive; only the "is this field
 * already declared?" question goes through a real parser, because answering it
 * from text needs full TOML semantics — quoted keys containing dots, escape
 * decoding, dotted keys and inline tables — that a line scanner cannot supply.
 */
function readCodexProviderTable(
  configTomlText: string,
  provider: string
): CodexProviderTableRead {
  const name = provider.trim()
  if (!name) return { status: "unparsable" }
  let parsed: unknown
  try {
    parsed = parseTomlDocument(configTomlText)
  } catch {
    return { status: "unparsable" }
  }
  if (!parsed || typeof parsed !== "object") return { status: "unparsable" }
  const providers = (parsed as Record<string, unknown>).model_providers
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return { status: "ok", table: null }
  }
  const table = (providers as Record<string, unknown>)[name]
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    return { status: "ok", table: null }
  }
  return { status: "ok", table: table as Record<string, unknown> }
}

/**
 * Mirrors the header half of codex's
 * `ModelProviderInfo::uses_openai_actor_authorization`. The ASCII-only fold
 * matches its `eq_ignore_ascii_case`.
 */
function codexProviderUsesActorAuthorization(
  table: Record<string, unknown> | null
): boolean {
  const headers = table?.http_headers
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return false
  }
  return Object.entries(headers as Record<string, unknown>).some(
    ([name, value]) =>
      name.replace(/[A-Z]/g, (char) => char.toLowerCase()) ===
        CODEX_ACTOR_AUTHORIZATION_HEADER &&
      typeof value === "string" &&
      value.trim() !== ""
  )
}

function ensureCodexProviderDefaults(
  configTomlText: string,
  provider: string
): string {
  if (provider.trim() !== CODEX_DEFAULT_MODEL_PROVIDER) {
    return configTomlText
  }
  let next = configTomlText
  const current = extractCodexTomlImportantValues(next)
  const codegBaseUrl =
    current.providerBaseUrls[CODEX_DEFAULT_MODEL_PROVIDER] ?? ""
  next = patchCodexProviderField(
    next,
    CODEX_DEFAULT_MODEL_PROVIDER,
    "base_url",
    `base_url = ${JSON.stringify(codegBaseUrl)}`
  )
  next = patchCodexProviderField(
    next,
    CODEX_DEFAULT_MODEL_PROVIDER,
    "name",
    'name = "codeg"'
  )
  next = patchCodexProviderField(
    next,
    CODEX_DEFAULT_MODEL_PROVIDER,
    "wire_api",
    'wire_api = "responses"'
  )
  // `requires_openai_auth` is the one managed field a user legitimately owns:
  // codex defaults it to false, and its `uses_openai_actor_authorization()`
  // requires `!requires_openai_auth`, so forcing true silently disables the
  // actor-authorization path. Supply codeg's default only when the provider
  // does not already declare it — true is right for a provider *we* created
  // (key in auth.json, no env_key), never for one the user configured.
  // Read the original text: the three patches above never touch
  // `requires_openai_auth` or `http_headers`, and the original is what the
  // user actually authored.
  const read = readCodexProviderTable(
    configTomlText,
    CODEX_DEFAULT_MODEL_PROVIDER
  )
  const providerTable = read.status === "ok" ? read.table : null
  const alreadyDeclared =
    read.status !== "ok" ||
    (providerTable !== null &&
      Object.prototype.hasOwnProperty.call(
        providerTable,
        "requires_openai_auth"
      ))
  if (!alreadyDeclared && !codexProviderUsesActorAuthorization(providerTable)) {
    next = patchCodexProviderField(
      next,
      CODEX_DEFAULT_MODEL_PROVIDER,
      "requires_openai_auth",
      "requires_openai_auth = true"
    )
  }
  return next
}

export function patchCodexConfigTomlText(
  configTomlText: string,
  patch: {
    apiBaseUrl?: string
    model?: string
    modelProvider?: string
    supportsWebsockets?: boolean
    skills?: boolean
    defaultModeRequestUserInput?: boolean
    serviceTierFast?: boolean
  }
): string {
  let nextTomlText = configTomlText
  if (typeof patch.modelProvider === "string") {
    const modelProvider = patch.modelProvider.trim()
    if (modelProvider) {
      nextTomlText = updateTomlRootStringKey(
        nextTomlText,
        "model_provider",
        modelProvider
      )
      nextTomlText = ensureCodexProviderDefaults(nextTomlText, modelProvider)
    }
  }
  if (typeof patch.model === "string") {
    nextTomlText = updateTomlRootStringKey(nextTomlText, "model", patch.model)
  }
  if (typeof patch.apiBaseUrl === "string") {
    const tomlValues = extractCodexTomlImportantValues(nextTomlText)
    const modelProvider =
      patch.modelProvider?.trim() ||
      tomlValues.modelProvider.trim() ||
      CODEX_DEFAULT_MODEL_PROVIDER
    if (!tomlValues.modelProvider.trim() && patch.apiBaseUrl.trim()) {
      nextTomlText = updateTomlRootStringKey(
        nextTomlText,
        "model_provider",
        modelProvider
      )
    }
    nextTomlText = patchCodexProviderBaseUrl(
      nextTomlText,
      modelProvider,
      patch.apiBaseUrl
    )
    nextTomlText = ensureCodexProviderDefaults(nextTomlText, modelProvider)
  }
  if (typeof patch.supportsWebsockets === "boolean") {
    const tomlValues = extractCodexTomlImportantValues(nextTomlText)
    const modelProvider =
      patch.modelProvider?.trim() ||
      tomlValues.modelProvider.trim() ||
      CODEX_DEFAULT_MODEL_PROVIDER
    if (!tomlValues.modelProvider.trim()) {
      nextTomlText = updateTomlRootStringKey(
        nextTomlText,
        "model_provider",
        modelProvider
      )
    }
    nextTomlText = patchCodexProviderField(
      nextTomlText,
      modelProvider,
      "supports_websockets",
      `supports_websockets = ${patch.supportsWebsockets ? "true" : "false"}`
    )
    nextTomlText = ensureCodexProviderDefaults(nextTomlText, modelProvider)
  }
  const normalizedTomlValues = extractCodexTomlImportantValues(nextTomlText)
  if (normalizedTomlValues.model.trim()) {
    nextTomlText = updateTomlRootStringKey(
      nextTomlText,
      "model",
      normalizedTomlValues.model
    )
  }
  const activeProvider =
    normalizedTomlValues.modelProvider.trim() || CODEX_DEFAULT_MODEL_PROVIDER
  // This key is rewritten on EVERY patch, including ones that have nothing to
  // do with WebSockets, so it must resolve the flag exactly the way
  // `extractCodexImportantValues` does — including its fallback to the feature
  // key itself when the provider declares no `supports_websockets`. Reading
  // only the provider field would treat "declared solely as a feature flag" as
  // "off" and delete the user's setting the next time any other control moved.
  // `??` and not `||`: an explicit `false` on the provider must win over the
  // fallback, which is how the WebSocket switch turns itself off.
  const shouldEnableFeature =
    normalizedTomlValues.providerSupportsWebsockets[activeProvider] ??
    (activeProvider === CODEX_DEFAULT_MODEL_PROVIDER
      ? normalizedTomlValues.featureResponsesWebsocketsV2
      : false)
  nextTomlText = upsertTomlSectionBooleanKey(
    nextTomlText,
    "features",
    "responses_websockets_v2",
    shouldEnableFeature ? true : null
  )
  if (typeof patch.skills === "boolean") {
    nextTomlText = upsertTomlSectionBooleanKey(
      nextTomlText,
      "features",
      "skills",
      patch.skills ? true : null
    )
  }
  if (typeof patch.defaultModeRequestUserInput === "boolean") {
    // Upstream default is false, so "off" removes the key instead of writing
    // `= false` — same contract as `skills` above, and it keeps config.toml
    // free of a flag the user never opted into.
    nextTomlText = upsertTomlSectionBooleanKey(
      nextTomlText,
      "features",
      CODEX_DEFAULT_MODE_REQUEST_USER_INPUT_KEY,
      patch.defaultModeRequestUserInput ? true : null
    )
  }
  if (typeof patch.serviceTierFast === "boolean") {
    nextTomlText = updateTomlRootStringKey(
      nextTomlText,
      "service_tier",
      patch.serviceTierFast ? "fast" : ""
    )
  }
  nextTomlText = updateTomlRootBooleanKey(
    nextTomlText,
    "disable_response_storage",
    true
  )
  const trimmed = nextTomlText.trim()
  return trimmed ? `${trimmed}\n` : ""
}
