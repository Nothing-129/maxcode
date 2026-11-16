import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

describe("Mainland China automation calendar UI", () => {
  beforeEach(() => {
    resetAppWorkspaceStore()
    preview.mockReset().mockResolvedValue("2026-02-28T01:00:00Z")
  })

  it("includes makeup weekends by resetting weekday cron and saves Beijing time", async () => {
    const submit = mount({
      ...draft,
      trigger_kind: "schedule",
      cron: "30 8 * * 1-5",
      timezone: "America/New_York",
    })
    fireEvent.change(screen.getByLabelText(en.Automations.calendarFilter), {
      target: { value: "cn_workday" },
    })
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith(
        "30 8 * * *",
        "Asia/Shanghai",
        "cn_workday"
      )
    )
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          cron: "30 8 * * *",
          timezone: "Asia/Shanghai",
          config: expect.objectContaining({ calendar_filter: "cn_workday" }),
        })
      )
    )
  })

  it("restores a saved holiday filter and surfaces missing calendar data", async () => {
    preview.mockRejectedValue(
      new Error("holiday-cn: 2027 calendar has not been published")
    )
    mount({
      ...draft,
      trigger_kind: "schedule",
      cron: "0 9 * * *",
      config: { ...draft.config, calendar_filter: "cn_holiday" },
    })
    expect(screen.getByLabelText(en.Automations.calendarFilter)).toHaveValue(
      "cn_holiday"
    )
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "2027 calendar has not been published"
      )
    )
    expect(preview).toHaveBeenCalledWith(
      "0 9 * * *",
      "Asia/Shanghai",
      "cn_holiday"
    )
  })
})
