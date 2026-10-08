import { afterEach, describe, expect, it } from "vitest"
import { source } from "./contract-source"
import { isSearchNoMatchResult } from "@/lib/search-no-match"
import { parseAskQuestionOutcome } from "@/lib/ask-question"
import {
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "@/stores/conversation-runtime-store"
import type { MessageTurn } from "@/lib/types"

describe("MaxCode selected upstream repairs October 8", () => {
  afterEach(() => resetConversationRuntimeStore())
  it("registers independent executable Rust contracts", () => {
    expect(source("src-tauri/src/acp/connection.rs")).toContain(
      "mod maxcode_upstream_runtime_20261008_contract;"
    )
    expect(source("src-tauri/src/acp/background_watch.rs")).toContain(
      "mod maxcode_transcript_linear_memory_contract;"
    )
    expect(source("src-tauri/src/parsers/codex.rs")).toContain(
      "mod maxcode_codex_desktop_history_contract;"
    )
  })
  it("recognizes a silent no-match pipeline through the shared search policy", () => {
    const probe = {
      toolName: "bash",
      input: JSON.stringify({ command: "rg --files src | rg missing" }),
      output: "[terminal exited: exit code: 1]",
      isError: true,
    }
    expect(isSearchNoMatchResult(probe)).toBe(true)
    for (const input of [
      "pnpm test",
      "! rg x",
      "rg x && false",
      "grep x < missing",
    ]) {
      expect(isSearchNoMatchResult({ ...probe, input })).toBe(false)
    }
    expect(
      isSearchNoMatchResult({
        ...probe,
        output: "missing path\n[terminal exited: exit code: 1]",
      })
    ).toBe(false)
    expect(
      isSearchNoMatchResult({
        ...probe,
        output: "[terminal exited: exit code: 2]",
      })
    ).toBe(false)
  })
  it("reads Codex custom answers as the user's text", () => {
    const result = parseAskQuestionOutcome(
      JSON.stringify({
        answers: {
          q: {
            answers: ["None of the above", "user_note: Inspect the flaky test"],
          },
        },
      })
    )
    expect(result?.answers[0].selected).toEqual(["Inspect the flaky test"])
  })
})

it("keeps a settled background Bash card's real output and consumes its notification", () => {
  resetConversationRuntimeStore()
  const state = useConversationRuntimeStore.getState().actions
  const output =
    "Command was moved to the background (ID: task) so that a message that arrived while it was running can reach you; it was not interrupted. Output is being written to: /tmp/task.output. You will be notified when it completes."
  const turn: MessageTurn = {
    id: "shell",
    role: "assistant",
    timestamp: "2026-10-08T01:00:00Z",
    blocks: [
      {
        type: "tool_use",
        tool_use_id: "shell-call",
        tool_name: "Bash",
        input_preview: '{"command":"sleep 10"}',
      },
      {
        type: "tool_result",
        tool_use_id: "shell-call",
        output_preview: output,
        is_error: false,
      },
    ],
  }
  state.appendOptimisticTurn(7, turn, "prompt")
  state.completeTurn(7, null)
  state.resolveBackgroundTask(7, {
    toolUseId: "shell-call",
    taskId: "task",
    status: "completed",
    summary: "done",
    result: null,
  })
  const session = useConversationRuntimeStore
    .getState()
    .byConversationId.get(7)!
  expect(session.localTurns[0].blocks[1]).toEqual(turn.blocks[1])
  expect(session.pendingBackgroundSettlements).toEqual([])
  resetConversationRuntimeStore()
})
