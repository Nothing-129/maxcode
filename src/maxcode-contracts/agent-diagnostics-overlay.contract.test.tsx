import { useState, type ReactNode } from "react"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { InAppSettings } from "@/components/settings/in-app-settings"
import { AgentDiagnosticsDialog } from "@/components/settings/agent-diagnostics-dialog"
import { acpEnvDiagnostics } from "@/lib/api"
import { requestInAppSettings } from "@/lib/in-app-settings"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace",
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/lib/transport/detect", () => ({ detectEnvironment: () => "web" }))
vi.mock("@/lib/api", () => ({ acpEnvDiagnostics: vi.fn() }))
vi.mock("@/components/layout/app-title-bar", () => ({
  AppTitleBar: ({ left }: { left?: ReactNode }) => <header>{left}</header>,
}))
vi.mock("@/components/ui/app-toaster", () => ({ AppToaster: () => null }))
// Keep the settings host and shared diagnostics dialog real; isolate the
// unrelated agent configuration APIs from this portal/stacking regression.
vi.mock("@/app/settings/agents/page", () => ({
  default: function DiagnosticsPage() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Diagnose</button>
        <AgentDiagnosticsDialog
          open={open}
          onOpenChange={setOpen}
          agentType="codex"
        />
      </>
    )
  },
}))

afterEach(() => vi.clearAllMocks())

describe("agent diagnostics above in-window settings", () => {
  it("shows loading above settings, then an actionable error and retry result", async () => {
    const user = userEvent.setup()
    let rejectProbe!: (error: Error) => void
    vi.mocked(acpEnvDiagnostics).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectProbe = reject
        })
    )
    render(
      <InAppSettings>
        <div>Workspace</div>
      </InAppSettings>
    )
    act(() => {
      expect(requestInAppSettings({ section: "agents" })).toBe(true)
    })
    await user.click(await screen.findByRole("button", { name: "Diagnose" }))
    const dialog = await screen.findByRole("dialog", { name: "title" })
    expect(within(dialog).getByText("loading")).toBeVisible()
    expect(acpEnvDiagnostics).toHaveBeenCalledWith("codex")

    // jsdom cannot hit-test occlusion. Assert both real stacking layers:
    // z-100 on the settings surface used to cover this body-portalled dialog.
    const settings = document.querySelector("[data-in-app-settings]")
    expect(settings).toHaveClass("z-40")
    expect(settings).not.toContainElement(dialog)
    expect(dialog.parentElement).toHaveClass("z-50")
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      "z-50"
    )

    await act(async () => rejectProbe(new Error("Probe unavailable")))
    expect(within(dialog).getByText("error: Probe unavailable")).toBeVisible()
    vi.mocked(acpEnvDiagnostics).mockResolvedValueOnce({
      generated_at: "",
      agent_type: "codex",
      verdict: { level: "ok", code: "ok", summary: "Ready" },
      sections: [],
      plain_text: "Ready",
    })
    await user.click(within(dialog).getByRole("button", { name: "rerun" }))
    expect(await within(dialog).findByText("verdict.ok")).toBeVisible()
    expect(acpEnvDiagnostics).toHaveBeenCalledTimes(2)
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("button", { name: "Diagnose" })).toBeVisible()
  })
})
