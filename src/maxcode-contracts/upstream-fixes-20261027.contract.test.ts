import { describe, expect, it } from "vitest"
import {
  compactionOnlyPart,
  hoistedCompaction,
  mergeConsecutiveAssistantTurns,
  type ResolvedMessageGroup,
  type ThreadRenderItem,
} from "@/components/message/message-list-view"
import { dedupeCompactionItems } from "@/lib/dedupe-compaction-items"
import { source } from "./contract-source"

const group = (id: string, compact = false): ResolvedMessageGroup => ({
  id,
  role: "assistant",
  resources: [],
  images: [],
  parts: compact
    ? [
        {
          type: "tool-call",
          toolCallId: "compact-event",
          toolName: "context_compaction",
          input: null,
          state: "output-available",
          output: "retained summary",
          meta: {
            contextCompaction: { version: 1 },
            "codeg.compactionSummary": true,
          },
        },
      ]
    : [{ type: "text", text: id }],
})
const turn = (
  g: ResolvedMessageGroup,
  source: "history" | "live" = "history"
): ThreadRenderItem => ({
  key: g.id,
  kind: "turn",
  group: g,
  phase: "persisted",
  source,
  compaction: compactionOnlyPart(g) ?? undefined,
  isResponseComplete: true,
  showStats: false,
  isRoleTransition: false,
  previousUserIndex: null,
  previousUserAt: null,
  isLastAssistantRun: false,
  isThreadTail: false,
  sourceTurns: [],
})

describe("reviewed October 27 upstream fixes", () => {
  it("keeps mid-reply compaction and its summary inside one reply, deduping promoted live copies", () => {
    const before = group("before")
    const compact = group("history-compaction", true)
    const live = group("promoted-compaction", true)
    const after = group("after")
    const groups = [before, compact, live, after]
    expect(hoistedCompaction(groups, 1)).toBeNull()
    const merged = mergeConsecutiveAssistantTurns(
      dedupeCompactionItems([
        turn(before),
        turn(compact),
        turn(live, "live"),
        turn(after),
      ])
    )
    expect(merged).toHaveLength(1)
    if (merged[0].kind !== "turn") throw new Error("expected merged reply")
    expect(merged[0].group.parts).toEqual([
      ...before.parts,
      ...compact.parts,
      ...after.parts,
    ])
    expect(compactionOnlyPart(compact)?.summary).toBe("retained summary")
  })

  it("pairs inline counter identities across sources one-to-one without swallowing later compactions", () => {
    const event = (id: string, source: "history" | "live") => {
      const g = group(id, true)
      const part = g.parts[0]
      if (part.type !== "tool-call") throw new Error("expected compaction")
      part.toolCallId = id
      part.meta = {
        contextCompaction: {
          version: 1,
          preTokens: 100,
          postTokens: 10,
          durationMs: 5,
        },
      }
      return turn(g, source)
    }
    const history = event("history", "history")
    const live = event("live", "live")
    const later = event("later", "live")
    expect(dedupeCompactionItems([history, live, later])).toEqual([
      history,
      later,
    ])
  })

  it("retains standalone manual/end compaction dividers", () => {
    const compact = group("compact", true)
    expect(hoistedCompaction([group("before"), compact], 1)?.callId).toBe(
      "compact-event"
    )
    expect(
      hoistedCompaction(
        [compact, { ...group("user"), role: "user" }, group("next")],
        0
      )
    ).not.toBeNull()
  })

  it("registers executable Git and Claude parser contracts and keeps MaxCode capability policy", () => {
    expect(source("src-tauri/src/work_task/git.rs")).toContain(
      "mod maxcode_git_real_filenames_contract;"
    )
    expect(source("src-tauri/src/parsers/claude.rs")).toContain(
      "mod maxcode_claude_097_advisor_contract;"
    )
    expect(source("src-tauri/src/acp/registry.rs")).toContain(
      "claude-agent-acp@0.97.0"
    )
    const connection = source("src-tauri/src/acp/connection.rs")
    expect(connection).toContain(
      "a_097_foreground_fork_completes_once_with_its_report"
    )
    expect(connection).toContain(
      '&["sessionFailure", "asyncTasks", "recommendedValue"]'
    )
    expect(source("src/components/chat/conversation-shell.tsx")).not.toContain(
      "<AsyncTaskStrip"
    )
  })
})
