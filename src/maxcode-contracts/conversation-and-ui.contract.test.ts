import { describe, expect, it } from "vitest"

import { resolveDefaultAgent } from "@/lib/resolve-default-agent"
import { isConversationActivity } from "@/lib/conversation-unread"
import { DEFAULT_UI_PREFERENCES } from "@/lib/ui-preferences-store"
import {
  loadShowCompleted,
  SIDEBAR_NAV_ITEM_IDS,
} from "@/lib/sidebar-view-mode-storage"
import {
  DEFAULT_EDITOR_FONT_ID,
  DEFAULT_TERMINAL_FONT_ID,
  DEFAULT_UI_FONT_ID,
} from "@/lib/font-presets"
import { resolveTurnDurationMs } from "@/components/message/turn-stats"
import {
  hasHorizontalDragIntent,
  TAB_DRAG_ACTIVATION_PX,
} from "@/hooks/use-long-press-drag"
import { source } from "./contract-source"

describe("MaxCode contract: conversation defaults and navigation", () => {
  it("remembers an explicit agent before folder, inherited, or sorted defaults", () => {
    const result = resolveDefaultAgent({
      lastSelected: "codex",
      folderDefault: "claude_code",
      inherit: "grok",
      sortedTypes: ["gemini"],
      fresh: true,
    })

    expect(result).toEqual({ agentType: "codex", provisional: false })
  })

  it("keeps completed sessions hidden by default and excludes retired navigation", () => {
    localStorage.clear()
    expect(loadShowCompleted()).toBe(false)
    expect(SIDEBAR_NAV_ITEM_IDS).toEqual(["automations", "tasks", "forge"])
  })

  it("treats settled message/status/child changes as unread, not live streaming", () => {
    const previous = { message_count: 1, status: "in_progress", child_count: 0 }
    expect(
      isConversationActivity(previous, {
        message_count: 2,
        status: "in_progress",
        child_count: 0,
      })
    ).toBe(false)
    expect(
      isConversationActivity(previous, {
        message_count: 2,
        status: "completed",
        child_count: 0,
      })
    ).toBe(true)
  })

  it("keeps status colors opt-in while status actions remain available", () => {
    expect(DEFAULT_UI_PREFERENCES.show_conversation_status).toBe(false)
    expect(DEFAULT_UI_PREFERENCES.allow_conversation_status_actions).toBe(true)
  })

  it("keeps the all-read action and authoritative folder ordering wired", () => {
    expect(source("src/stores/conversation-unread-store.ts")).toContain(
      "markAllRead: () =>"
    )
    const workspace = source("src/stores/app-workspace-store.ts")
    expect(workspace).toContain("a.sort_order - b.sort_order")
    const folders = source("src-tauri/src/db/service/folder_service.rs")
    expect(folders).toContain(
      "newly_added_folder_has_the_highest_sort_priority"
    )
    expect(folders).toContain(
      "reopened_folder_returns_with_the_highest_sort_priority"
    )
  })
})

describe("MaxCode contract: message and pointer presentation", () => {
  it("uses native system fonts by default", () => {
    expect(DEFAULT_UI_FONT_ID).toBe("system-ui")
    expect(DEFAULT_EDITOR_FONT_ID).toBe("system-mono")
    expect(DEFAULT_TERMINAL_FONT_ID).toBe("system-mono")
  })

  it("falls back to prompt-to-completion time when an agent omits duration", () => {
    expect(
      resolveTurnDurationMs(
        null,
        "2026-08-31T10:00:05.000Z",
        "2026-08-31T10:00:00.000Z"
      )
    ).toBe(5_000)
    expect(resolveTurnDurationMs(1_234, null, null)).toBe(1_234)
  })

  it("requires a deliberate horizontal trackpad movement before dragging", () => {
    expect(TAB_DRAG_ACTIVATION_PX).toBe(16)
    expect(hasHorizontalDragIntent(15, 0)).toBe(false)
    expect(hasHorizontalDragIntent(16, 4)).toBe(true)
    expect(hasHorizontalDragIntent(16, 20)).toBe(false)
  })

  it("keeps overflowing tabs scrollable and preserves native transcript selection", () => {
    expect(source("src/components/tabs/tab-bar.tsx")).toContain(
      "overflow-x-auto overflow-y-hidden"
    )
    const detailPanel = source(
      "src/components/conversations/conversation-detail-panel.tsx"
    )
    expect(detailPanel).toContain("disabled={isMobileWeb}")
    expect(detailPanel).toContain('WebkitTouchCallout: "default"')
  })
})
