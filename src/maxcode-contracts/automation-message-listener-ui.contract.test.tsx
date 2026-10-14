import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MessageListenerPanel } from "@/components/automations/message-listener-panel"
import { automationListenerStatus, automationRestartListener } from "@/lib/api"
import en from "@/i18n/messages/en.json"
import type { Automation } from "@/lib/types"
vi.mock("@/lib/api", () => ({
  automationListenerStatus: vi.fn(),
  automationRestartListener: vi.fn(),
}))
const auto: Automation = {
  id: 1,
  name: "Assistant",
  enabled: true,
  trigger_kind: "message",
  cron: null,
  timezone: "UTC",
  next_run_at: null,
  agent_type: "codex",
  root_folder_id: null,
  isolation: "shared_in_root",
  branch: null,
  is_remote_branch: false,
  config: {
    session_mode: "reuse_chat",
    display_text: "Handle work",
    prompt_blocks: [],
    config_values: {},
    message_trigger: {
      scope: "at-me",
      target: "",
      profile: "",
      keywords: "",
      batch_minutes: 10,
    },
  },
  last_run_at: null,
  last_run_status: null,
  last_run_conversation_id: null,
  unseen_failures: 0,
  created_at: "2026-10-13T00:00:00Z",
  updated_at: "2026-10-13T00:00:00Z",
}
function mount(value = auto) {
  const run = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MessageListenerPanel automation={value} onRun={run} />
    </NextIntlClientProvider>
  )
  return run
}
describe("Message listener controls", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(automationRestartListener).mockResolvedValue(undefined)
  })
  it("stays idle with an empty inbox and does not offer an executable empty batch", async () => {
    vi.mocked(automationListenerStatus).mockResolvedValue({
      state: "listening",
      error: null,
      pending_count: 0,
      last_received_at: null,
    })
    const run = mount()
    expect(
      await screen.findByText(en.Automations.listenerState_listening)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: en.Automations.processMessages })
    ).toBeDisabled()
    expect(run).not.toHaveBeenCalled()
  })
  it("processes a pending batch without creating a new task from the panel", async () => {
    vi.mocked(automationListenerStatus).mockResolvedValue({
      state: "listening",
      error: null,
      pending_count: 3,
      last_received_at: "2026-10-13T09:00:00Z",
    })
    const run = mount()
    await screen.findByText(
      en.Automations.listenerPending.replace("{count}", "3")
    )
    fireEvent.click(
      screen.getByRole("button", { name: en.Automations.processMessages })
    )
    expect(run).toHaveBeenCalledTimes(1)
  })
  it("exposes a listener failure and only reconnects on an explicit click", async () => {
    vi.mocked(automationListenerStatus).mockResolvedValue({
      state: "error",
      error: "Account unavailable",
      pending_count: 0,
      last_received_at: null,
    })
    mount()
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Account unavailable"
    )
    expect(automationRestartListener).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: en.Automations.listenerRestart })
    )
    await waitFor(() =>
      expect(automationRestartListener).toHaveBeenCalledWith(1)
    )
  })
  it("disables execution and reconnect while the automation is disabled", async () => {
    vi.mocked(automationListenerStatus).mockResolvedValue({
      state: "listening",
      error: null,
      pending_count: 3,
      last_received_at: null,
    })
    mount({ ...auto, enabled: false })
    expect(
      await screen.findByText(en.Automations.listenerState_stopped)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: en.Automations.processMessages })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: en.Automations.listenerRestart })
    ).toBeDisabled()
  })
})
