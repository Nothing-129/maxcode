import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AutomationEditor } from "@/components/automations/automation-editor"
import { resetAppWorkspaceStore } from "@/stores/app-workspace-store"
import en from "@/i18n/messages/en.json"
import type { Automation, AutomationDraft } from "@/lib/types"

const { enabledAgents, preview } = vi.hoisted(() => ({
  preview: vi.fn(),
  enabledAgents: [
    { agent_type: "grok", enabled: false, available: true },
    { agent_type: "pi", enabled: true, available: true },
    { agent_type: "claude_code", enabled: true, available: true },
    { agent_type: "codex", enabled: true, available: true },
  ],
}))
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  automationComputeNextRun: preview,
}))
vi.mock("@/hooks/use-acp-agents", () => ({
  useAcpAgents: () => ({ agents: enabledAgents }),
}))
vi.mock("@/components/chat/selector-tooltip", () => ({
  SelectorTooltip: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/components/chat/composer/rich-composer", () => ({
  RichComposer: () => null,
}))
vi.mock("@/components/chat/composer/use-reference-search", () => ({
  useReferenceSearch: () => ({}),
}))
vi.mock("@/components/chat/composer/use-composer-mention-labels", () => ({
  useComposerMentionLabels: () => ({ groupLabels: {}, uiLabels: {} }),
}))
vi.mock("@/components/automations/composer-invocations", () => ({
  ComposerInvocationsPopup: () => null,
  useComposerInvocations: () => ({}),
}))
vi.mock("@/components/automations/use-agent-options", () => ({
  useAgentOptions: () => ({ ensure: async () => null }),
}))
vi.mock("@/components/automations/agent-config-section", () => ({
  AgentConfigSection: () => null,
  effectiveSelections: () => ({ mode_id: null, config_values: {} }),
  snapshotLabels: () => ({}),
}))
vi.mock("@/components/automations/cron-builder-dialog", () => ({
  CronBuilderDialog: () => null,
}))
vi.mock("@/components/automations/automation-todo-picker", () => ({
  AutomationTodoPicker: () => null,
}))
vi.mock("@/components/automations/automation-branch-picker", () => ({
  AutomationBranchPicker: () => <div data-testid="branch-picker" />,
}))
vi.mock("@/components/shared/folder-select", () => ({
  FolderSelect: ({
    value,
    allLabel,
    onSelectAll,
  }: {
    value: number | null
    allLabel?: string
    onSelectAll?: () => void
  }) => (
    <div>
      <span data-testid="target">
        {value == null ? allLabel : String(value)}
      </span>
      {allLabel && <button onClick={onSelectAll}>{allLabel}</button>}
    </div>
  ),
}))

const draft: AutomationDraft = {
  name: "Daily chat check",
  enabled: true,
  trigger_kind: "manual",
  cron: null,
  timezone: "Asia/Shanghai",
  agent_type: "codex",
  root_folder_id: null,
  isolation: "shared_in_root",
  branch: "main",
  is_remote_branch: false,
  config: {
    display_text: "Check today's unfinished items",
    prompt_blocks: [],
    mode_id: null,
    config_values: {},
  },
}
function mount(value: AutomationDraft | Automation | null) {
  const submit = vi.fn().mockResolvedValue(undefined)
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AutomationEditor
        automation={value}
        onSubmit={submit}
        onCancel={() => {}}
      />
    </NextIntlClientProvider>
  )
  return submit
}

describe("automation editor organization", () => {
  beforeEach(() => {
    resetAppWorkspaceStore()
    preview.mockReset().mockResolvedValue(null)
  })

  it("groups the primary flow and keeps secondary settings collapsed without losing saved values", async () => {
    const submit = mount({
      ...draft,
      trigger_kind: "schedule",
      cron: "30-40/2 18 * * *",
      config: {
        ...draft.config,
        session_mode: "reuse_chat",
        hide_from_conversation_list: true,
      },
    })
    const groups = screen
      .getAllByRole("group")
      .filter((el) => el.tagName === "FIELDSET")
    expect(groups.map((el) => el.getAttribute("aria-label"))).toEqual([
      "What to do",
      "When to run",
      "Where to run",
    ])
    const execution = screen
      .getByText("Session and advanced settings")
      .closest("button")!
    const schedule = screen.getByText("Custom schedule").closest("button")!
    expect(execution).toHaveAttribute("aria-expanded", "false")
    expect(schedule).toHaveAttribute("aria-expanded", "false")
    expect(
      within(screen.getByRole("group", { name: "When to run" })).getByText(
        "30-40/2 18 * * *"
      )
    ).toBeInTheDocument()
    fireEvent.click(execution)
    const checkbox = screen.getByRole("checkbox", {
      name: "Hide from conversation list",
    })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    fireEvent.click(execution)
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toMatchObject({
      cron: "30-40/2 18 * * *",
      config: {
        session_mode: "reuse_chat",
        hide_from_conversation_list: false,
      },
    })
  })
  it("saves custom time edits after collapsing the schedule controls", async () => {
    const submit = mount({
      ...draft,
      trigger_kind: "schedule",
      cron: "0 9 * * *",
    })
    const disclosure = screen.getByText("Custom schedule").closest("button")!
    fireEvent.click(disclosure)
    fireEvent.change(screen.getByLabelText(en.Automations.cron), {
      target: { value: "15 18 * * 1-5" },
    })
    fireEvent.click(disclosure)
    expect(disclosure).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("15 18 * * 1-5")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          cron: "15 18 * * 1-5",
          timezone: "Asia/Shanghai",
        })
      )
    )
  })
})
