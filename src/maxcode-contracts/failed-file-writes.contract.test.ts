import { describe, expect, it } from "vitest"
import {
  buildSessionFileDiff,
  extractReplyFileChanges,
  extractSessionFiles,
  extractSessionFilesGrouped,
} from "@/lib/session-files"
import type { ContentBlock, MessageTurn } from "@/lib/types"

const path = "/repo/web-allowed.txt"
const user: MessageTurn = {
  id: "user-1",
  role: "user",
  timestamp: "2026-09-27T00:00:00Z",
  blocks: [{ type: "text", text: "Write a file" }],
}
function assistant(id: string, blocks: ContentBlock[]): MessageTurn {
  return {
    id,
    role: "assistant",
    timestamp: "2026-09-27T00:00:01Z",
    blocks,
  }
}
function write(
  id: string | null,
  content: string,
  status?: string | null
): ContentBlock {
  return {
    type: "tool_use",
    tool_name: "Write",
    tool_use_id: id,
    input_preview: JSON.stringify({ file_path: path, content }),
    status,
  }
}
function failedResult(id: string | null): ContentBlock {
  return {
    type: "tool_result",
    tool_use_id: id,
    output_preview: "Plan mode only allows read-only, non-destructive tools",
    is_error: true,
  }
}
function expectNoChanges(turns: MessageTurn[]) {
  expect(extractReplyFileChanges(turns)).toEqual([])
  expect(extractSessionFiles(turns)).toEqual([])
  expect(extractSessionFilesGrouped(turns)).toEqual([])
  expect(
    extractSessionFilesGrouped(turns, { includeEmpty: true })[0].files
  ).toEqual([])
  expect(buildSessionFileDiff(turns, user.id, path)).toBe(
    `No diff data available for ${path}`
  )
}

describe("MaxCode failed file writes do not claim completed edits", () => {
  it("excludes the real ZCode plan-mode Write failure from every change summary", () => {
    // Shape captured through get_folder_conversation after a denied Write:
    // both failure signals were correct, but its input produced an invented +1.
    expectNoChanges([
      user,
      assistant("a1", [
        write("call-failed", "WEB_ALLOW_OK", "failed"),
        failedResult("call-failed"),
      ]),
    ])
  })

  it("recognizes either failure signal, including results in another sub-turn", () => {
    expectNoChanges([
      user,
      assistant("a1", [write(null, "STATUS_ONLY", "failed")]),
    ])
    expectNoChanges([
      user,
      assistant("a1", [write("call-failed", "RESULT_ONLY")]),
      assistant("a2", [failedResult("call-failed")]),
    ])
  })

  it("counts a successful retry of the same path without the failed attempt's diff", () => {
    const turns = [
      user,
      assistant("a1", [
        write("call-failed", "FAILED_ATTEMPT"),
        failedResult("call-failed"),
      ]),
      assistant("a2", [write("call-success", "SUCCESS", "completed")]),
    ]
    const [file] = extractReplyFileChanges(turns)
    expect(file).toMatchObject({ path, additions: 1, deletions: 0 })
    expect(file.diff).toContain("+SUCCESS")
    expect(file.diff).not.toContain("FAILED_ATTEMPT")
    const [group] = extractSessionFilesGrouped(turns)
    expect(group.files).toHaveLength(1)
    expect(group.files[0].additions).toBe(1)
    const diff = buildSessionFileDiff(turns, user.id, path)
    expect(diff).toContain("+SUCCESS")
    expect(diff).not.toContain("FAILED_ATTEMPT")
    expect(extractSessionFiles(turns)).toEqual([
      { path, operations: ["write"] },
    ])
  })

  it.each([undefined, null, "running", "completed"])(
    "preserves existing write evidence with status %s and no correlated failure",
    (status) => {
      const turns = [
        user,
        assistant("a1", [
          write(null, "HISTORICAL", status),
          // Missing ids cannot associate an error with an unrelated operation.
          failedResult(null),
        ]),
      ]
      expect(extractReplyFileChanges(turns)).toHaveLength(1)
      expect(extractSessionFilesGrouped(turns)[0].files).toHaveLength(1)
      expect(buildSessionFileDiff(turns, user.id, path)).toContain(
        "+HISTORICAL"
      )
    }
  )
})
