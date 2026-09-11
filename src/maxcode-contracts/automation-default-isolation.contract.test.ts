import { describe, expect, it } from "vitest"

import {
  AUTOMATION_TEMPLATES,
  templateToDraft,
} from "@/components/automations/automation-templates"
import { source } from "./contract-source"

describe("MaxCode contract: automation worktree is opt-in", () => {
  it("defaults blank creates to the shared folder while preserving saved isolation", () => {
    const editor = source("src/components/automations/automation-editor.tsx")

    expect(editor).toContain('automation?.isolation ?? "shared_in_root"')
    expect(editor).toContain('checked={isolation === "worktree_per_run"}')
    expect(editor).toContain(
      'v === true ? "worktree_per_run" : "shared_in_root"'
    )
  })

  it.each(AUTOMATION_TEMPLATES)(
    "leaves worktree unchecked when creating from $id",
    (template) => {
      const draft = templateToDraft(template, {
        name: "Scheduled review",
        agentType: "claude_code",
        folderId: 1,
      })

      expect(draft.isolation).toBe("shared_in_root")
    }
  )
})
