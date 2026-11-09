import { render, screen, fireEvent } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import type { Automation } from "@/lib/types"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"

// ── Context + side-effect mocks ────────────────────────────────────────────
const openTab = vi.fn()
const refetch = vi.fn().mockResolvedValue(undefined)
let automations: Automation[] = []

vi.mock("@/contexts/automations-view-context", () => ({
  useAutomationsView: () => ({ automations, unseenFailures: 0, refetch }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openConversations: vi.fn() }),
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({ openTab }),
}))
vi.mock("@/lib/platform", () => ({
  subscribe: vi.fn().mockResolvedValue(() => {}),
  onTransportReconnect: vi.fn(() => () => {}),
}))
vi.mock("@/lib/api", () => ({
  automationMarkSeen: vi.fn().mockResolvedValue(undefined),
  automationCreate: vi.fn(),
  automationUpdate: vi.fn(),
  automationDelete: vi.fn(),
  automationRunNow: vi.fn(),
  automationSetEnabled: vi.fn(),
  automationCancelRun: vi.fn(),
  automationRuns: vi.fn().mockResolvedValue([]),
  getFolderConversation: vi.fn(),
}))

// Stub the heavy editor (AgentSelector / config probing) — surface only the
// seeded automation name and the back affordance so we can assert page wiring.
vi.mock("@/components/automations/automation-editor", () => ({
  AutomationEditor: ({
    automation,
    onBackToTemplates,
  }: {
    automation: { name?: string } | null
    onBackToTemplates?: () => void
  }) => (
    <div>
      <div data-testid="editor-name">{automation?.name ?? "<blank>"}</div>
      {onBackToTemplates ? (
        <button type="button" onClick={onBackToTemplates}>
          back-link
        </button>
      ) : null}
    </div>
  ),
}))

import { AutomationsPage } from "@/components/automations/automations-page"

// Components select `folders` from the real zustand store — seed it with the
// same data the old context mock provided.
beforeEach(() => {
  resetAppWorkspaceStore()
  useAppWorkspaceStore.setState({
    folders: [{ id: 1, name: "repo" }] as never,
  })
})

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AutomationsPage />
    </NextIntlClientProvider>
  )
}

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }))

const FIXTURE: Automation = {
  id: 7,
  name: "Nightly sweep",
  enabled: true,
  trigger_kind: "manual",
  cron: null,
  timezone: "UTC",
  next_run_at: null,
  agent_type: "claude_code",
  root_folder_id: 1,
  isolation: "worktree_per_run",
  branch: null,
  is_remote_branch: false,
  config: {
    prompt_blocks: [{ type: "text", text: "do the thing" }],
    display_text: "do the thing",
    config_values: {},
  },
  last_run_at: null,
  last_run_status: null,
  last_run_conversation_id: null,
  unseen_failures: 0,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
}

describe("MaxCode contract: mobile automation navigation", () => {
  beforeEach(() => {
    automations = [FIXTURE]
  })

  it("opens a task in a separate full-width detail and returns to the list", () => {
    const { container } = renderPage()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    expect(container.querySelector("[data-panel-group-direction]")).toBeNull()
    fireEvent.click(screen.getByText(FIXTURE.name))
    expect(screen.getByRole("switch")).toBeInTheDocument()
    expect(screen.getByText("do the thing")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: enMessages.Automations.title })
    )
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
    expect(screen.getByText(FIXTURE.name)).toBeInTheDocument()
  })
})
