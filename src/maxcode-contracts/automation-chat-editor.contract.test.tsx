import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AutomationEditor } from "@/components/automations/automation-editor"
import {
  useAppWorkspaceStore,
  resetAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import en from "@/i18n/messages/en.json"
import type { AutomationDraft } from "@/lib/types"

vi.mock("@/components/chat/agent-selector", () => ({
  AgentSelector: () => null,
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
  root_folder_id: 1,
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
function mount(value: AutomationDraft) {
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

describe("Chat automation editor", () => {
  beforeEach(() => {
    resetAppWorkspaceStore()
    useAppWorkspaceStore.setState({
      folders: [
        {
          id: 1,
          name: "Project",
          path: "/tmp/project",
          kind: "regular",
          parent_id: null,
        },
      ] as ReturnType<typeof useAppWorkspaceStore.getState>["folders"],
    })
  })
  it("switches a pinned project automation to chat and clears its Git fields", async () => {
    const submit = mount(draft)
    expect(screen.getByTestId("branch-picker")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: en.Automations.targetChat })
    )
    expect(screen.queryByTestId("branch-picker")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          root_folder_id: null,
          branch: null,
          is_remote_branch: false,
          isolation: "shared_in_root",
        })
      )
    )
  })
  it("preserves a saved chat target when project folders are available", async () => {
    const submit = mount({ ...draft, root_folder_id: null, branch: null })
    expect(screen.getByTestId("target")).toHaveTextContent(
      en.Automations.targetChat
    )
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ root_folder_id: null })
      )
    )
  })
  it("requires a project for task-board automations even when no folders exist", async () => {
    useAppWorkspaceStore.setState({ folders: [] })
    const submit = mount({
      ...draft,
      root_folder_id: null,
      config: { ...draft.config, action: "enqueue_task" },
    })
    expect(
      screen.queryByRole("button", { name: en.Automations.targetChat })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.Automations.errorFolder
    )
    expect(submit).not.toHaveBeenCalled()
  })
  it("switches a project automation to a reusable chat", async () => {
    const submit = mount(draft)
    fireEvent.click(
      screen.getByRole("button", { name: en.Automations.sessionReuse })
    )
    expect(screen.getByTestId("target")).toHaveTextContent(
      en.Automations.targetChat
    )
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          root_folder_id: null,
          branch: null,
          config: expect.objectContaining({ session_mode: "reuse_chat" }),
        })
      )
    )
  })
  it("offers event batching and saves message triggers without a cron or a project", async () => {
    const submit = mount(draft)
    fireEvent.click(
      screen.getByRole("button", { name: en.Automations.triggerMessage })
    )
    expect(
      screen.getByRole("button", { name: en.Automations.sessionNew })
    ).toBeDisabled()
    expect(screen.queryByTestId("branch-picker")).not.toBeInTheDocument()
    expect(
      screen.getByText(
        en.Automations.messageBatchMinutes.replace("{minutes}", "10")
      )
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(en.Automations.messageKeywords), {
      target: { value: "todo" },
    })
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger_kind: "message",
          cron: null,
          root_folder_id: null,
          config: expect.objectContaining({
            session_mode: "reuse_chat",
            message_trigger: {
              scope: "at-me",
              target: "",
              profile: "",
              keywords: "todo",
              batch_minutes: 10,
            },
          }),
        })
      )
    )
  })
  it("validates a saved group listener before allowing a blank target", async () => {
    const submit = mount({
      ...draft,
      root_folder_id: null,
      trigger_kind: "message",
      branch: null,
      config: {
        ...draft.config,
        session_mode: "reuse_chat",
        message_trigger: {
          scope: "group",
          target: "",
          profile: "",
          keywords: "",
          batch_minutes: 0,
        },
      },
    })
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.Automations.errorMessageTarget
    )
    expect(submit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(en.Automations.messageGroup), {
      target: { value: "Operations" },
    })
    fireEvent.click(screen.getByRole("button", { name: en.Automations.save }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  })
})
