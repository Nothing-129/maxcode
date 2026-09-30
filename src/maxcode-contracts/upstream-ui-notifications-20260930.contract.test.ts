import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { signInAgentForTurnFailure } from "@/lib/agent-sign-in"
import { MAINTAINED_AGENT_TYPES } from "@/lib/maintained-agents"
import { sessionNotificationPayload } from "@/lib/notification-session"
import {
  notifyDesktop,
  resetDesktopNotificationStateForTests,
  withDesktopNotificationsSuppressed,
} from "@/lib/desktop-notification"
import {
  DEFAULT_DESKTOP_NOTIFICATION_PREFS,
  resetDesktopNotificationPrefsCacheForTests,
  saveDesktopNotificationPrefs,
} from "@/lib/desktop-notification-prefs"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { resetTabStore } from "@/stores/tab-store"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"

const deliver = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/notification", () => ({
  deliverSystemNotification: deliver,
  getNotificationPermission: () => "managed_by_os",
}))

beforeEach(() => {
  localStorage.clear()
  resetDesktopNotificationPrefsCacheForTests()
  resetDesktopNotificationStateForTests()
  resetAppWorkspaceStore()
  resetTabStore()
  deliver.mockClear()
  saveDesktopNotificationPrefs({
    ...DEFAULT_DESKTOP_NOTIFICATION_PREFS,
    when: "always",
  })
  useAppWorkspaceStore.setState({
    allFolders: [{ id: 2, name: "backend", alias: "Service" } as FolderDetail],
    conversations: [
      {
        id: 42,
        folder_id: 2,
        title: "Fix [auth.ts](file:///service/auth.ts) after sign-out",
        // A /clear can change this independently of the ACP session id.
        external_id: "transcript-after-clear",
      } as DbConversationSummary,
    ],
  })
})

afterEach(() => {
  resetTabStore()
  resetAppWorkspaceStore()
  resetDesktopNotificationPrefsCacheForTests()
  resetDesktopNotificationStateForTests()
  localStorage.clear()
})

describe("MaxCode contract: closed-pane notifications retain session identity and privacy", () => {
  const payload = () =>
    sessionNotificationPayload(
      "pane-that-was-closed",
      42,
      "active-other-repo",
      {
        body: "Codex needs permission for a secret operation",
        redactedBody: "Codex needs permission",
      }
    )

  it("uses the conversation's own folder and title after its pane disappears", async () => {
    await notifyDesktop("permission_request", payload())
    expect(deliver).toHaveBeenCalledWith(
      "Fix auth.ts after sign-out",
      "Service · Codex needs permission for a secret operation"
    )
  })

  it("redacts the user's session title and agent output with MaxCode branding", async () => {
    saveDesktopNotificationPrefs({
      ...DEFAULT_DESKTOP_NOTIFICATION_PREFS,
      when: "always",
      hideBody: true,
    })
    await notifyDesktop("permission_request", payload())
    expect(deliver).toHaveBeenCalledWith(
      "Service - MaxCode",
      "Codex needs permission"
    )
  })

  it("keeps snapshot replay silent and collapses duplicate live deliveries", async () => {
    await withDesktopNotificationsSuppressed(() =>
      notifyDesktop("permission_request", payload())
    )
    expect(deliver).not.toHaveBeenCalled()
    await Promise.all([
      notifyDesktop("permission_request", payload()),
      notifyDesktop("permission_request", payload()),
    ])
    expect(deliver).toHaveBeenCalledTimes(1)
  })
})

describe("MaxCode contract: credential actions remain owner-only", () => {
  const owner = {
    agentType: "claude_code" as const,
    isViewer: false,
    isDelegationChild: false,
  }

  it.each(MAINTAINED_AGENT_TYPES)(
    "opens only the owning %s agent's settings",
    (agentType) => {
      expect(
        signInAgentForTurnFailure(
          "turn_failed_auth_required",
          { ...owner, agentType },
          false,
          "/workspace"
        )
      ).toBe(agentType)
    }
  )

  it("offers no credential action on viewer, delegation, public share or echo surfaces", () => {
    const code = "turn_failed_auth_required"
    expect(
      signInAgentForTurnFailure(
        code,
        { ...owner, isViewer: true },
        false,
        "/workspace"
      )
    ).toBeNull()
    expect(
      signInAgentForTurnFailure(
        code,
        { ...owner, isDelegationChild: true },
        false,
        "/workspace"
      )
    ).toBeNull()
    expect(
      signInAgentForTurnFailure(code, owner, true, "/workspace")
    ).toBeNull()
    for (const path of ["/share", "/share/", "/share.html"]) {
      expect(signInAgentForTurnFailure(code, owner, false, path)).toBeNull()
    }
    expect(
      signInAgentForTurnFailure(code, null, false, "/workspace")
    ).toBeNull()
    expect(
      signInAgentForTurnFailure(
        code,
        { ...owner, agentType: "gemini" },
        false,
        "/workspace"
      )
    ).toBeNull()
    expect(
      signInAgentForTurnFailure("turn_failed_empty", owner, false, "/workspace")
    ).toBeNull()
  })
})
