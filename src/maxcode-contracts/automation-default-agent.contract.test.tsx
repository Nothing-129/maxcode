import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AutomationEditor } from "@/components/automations/automation-editor"
import { resetAppWorkspaceStore } from "@/stores/app-workspace-store"
import en from "@/i18n/messages/en.json"
import type { Automation, AutomationDraft } from "@/lib/types"

const { enabledAgents } = vi.hoisted(() => ({
  enabledAgents: [
    { agent_type: "grok", enabled: false, available: true },
    { agent_type: "pi", enabled: true, available: true },
    { agent_type: "claude_code", enabled: true, available: true },
    { agent_type: "codex", enabled: true, available: true },
  ],
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

describe("Automation default agent contract", () => {
  beforeEach(() => resetAppWorkspaceStore())

  it("selects the first enabled agent on every blank create", () => {
    mount(null)
    expect(
      document.querySelector('[data-slot="agent-pill"][aria-pressed="true"]')
    ).toHaveTextContent("Pi")
  })

  it("uses the first enabled agent for templates and persists it", async () => {
    const submit = mount(draft)
    expect(
      document.querySelector('[data-slot="agent-pill"][aria-pressed="true"]')
    ).toHaveTextContent("Pi")
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ agent_type: "pi" })
      )
    )
  })

  it("keeps an explicit selection across form changes", () => {
    mount(draft)
    const pills = document.querySelectorAll('[data-slot="agent-pill"]')
    fireEvent.click(pills[1])
    fireEvent.change(
      screen.getByRole("textbox", { name: en.Automations.name }),
      {
        target: { value: "Renamed" },
      }
    )
    expect(
      document.querySelector('[data-slot="agent-pill"][aria-pressed="true"]')
    ).toHaveTextContent("Claude")
  })

  it("preserves the saved agent when editing", () => {
    mount({ ...draft, id: 42 } as Automation)
    expect(
      document.querySelector('[data-slot="agent-pill"][aria-pressed="true"]')
    ).toHaveTextContent("Codex")
  })
})
