import type { ReactNode } from "react"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { InAppSettings } from "@/components/settings/in-app-settings"
import { SettingsShell } from "@/components/settings/settings-shell"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { requestInAppSettings } from "@/lib/in-app-settings"

const runtime = vi.hoisted(() => ({ mobile: true, push: vi.fn() }))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/general",
  useRouter: () => ({ push: runtime.push }),
}))
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => runtime.mobile,
}))
vi.mock("@/lib/transport/detect", () => ({
  detectEnvironment: () => "web",
}))
vi.mock("@/components/layout/app-title-bar", () => ({
  AppTitleBar: ({ left }: { left?: ReactNode }) => <header>{left}</header>,
}))
vi.mock("@/components/ui/app-toaster", () => ({ AppToaster: () => null }))
vi.mock("@/app/settings/general/page", () => ({
  default: () => <input aria-label="General draft" defaultValue="Original" />,
}))
vi.mock("@/app/settings/appearance/page", () => ({
  default: () => <div>Appearance loaded</div>,
}))

beforeEach(() => {
  runtime.mobile = true
  runtime.push.mockClear()
  window.history.replaceState(null, "", "/workspace?conversation=7")
})

function openSettings() {
  act(() => {
    expect(requestInAppSettings({ section: "general" })).toBe(true)
  })
}

async function openNavigation() {
  fireEvent.click(screen.getByRole("button", { name: "title" }))
  return screen.findByRole("dialog", { name: "title" })
}

async function expectNavigationClosed() {
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "title" })).toBeNull()
  })
}

describe("mobile in-window settings navigation", () => {
  it("opens the top-right category menu above settings and retains drafts through navigation and return", async () => {
    render(
      <InAppSettings>
        <textarea aria-label="Workspace draft" defaultValue="Unsent" />
      </InAppSettings>
    )
    const workspaceDraft = screen.getByLabelText("Workspace draft")
    openSettings()
    const generalDraft = await screen.findByLabelText("General draft")
    fireEvent.change(generalDraft, { target: { value: "Unsaved setting" } })
    const navigation = await openNavigation()

    // jsdom cannot hit-test occluded elements. Pin the actual stacking layers
    // as well as the interaction: the old z-[100] settings surface covered the
    // body-portalled z-50 drawer even though its open state changed correctly.
    const settings = document.querySelector("[data-in-app-settings]")
    expect(settings).toHaveClass("z-40")
    expect(navigation.closest('[data-slot="drawer-viewport"]')).toHaveClass(
      "z-50"
    )
    expect(settings).not.toContainElement(navigation)
    expect(navigation).toBeVisible()
    expect(workspaceDraft).not.toBeVisible()

    fireEvent.click(
      within(navigation).getByRole("button", { name: "nav.appearance" })
    )
    await screen.findByText("Appearance loaded")
    await expectNavigationClosed()
    expect(generalDraft).not.toBeVisible()

    const reopened = await openNavigation()
    expect(
      within(reopened).getByRole("button", { name: "nav.appearance" })
    ).toHaveAttribute("aria-current", "page")
    fireEvent.click(
      within(reopened).getByRole("button", { name: "nav.general" })
    )
    await expectNavigationClosed()
    expect(screen.getByLabelText("General draft")).toBe(generalDraft)
    expect(generalDraft).toHaveValue("Unsaved setting")
    expect(generalDraft).toBeVisible()
    expect(runtime.push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "backToApp" }))
    expect(workspaceDraft).toBeVisible()
    expect(workspaceDraft).toHaveValue("Unsent")
    expect(window.location.search).toBe("?conversation=7")
    expect(document.querySelector("[data-in-app-settings]")).toBeNull()
  })

  it("dismisses the menu by pressing the settings page or Escape and can reopen it", async () => {
    const user = userEvent.setup()
    render(
      <InAppSettings>
        <div>Workspace</div>
      </InAppSettings>
    )
    openSettings()
    const generalDraft = await screen.findByLabelText("General draft")
    await openNavigation()
    await user.click(generalDraft)
    await expectNavigationClosed()
    expect(generalDraft).toBeVisible()
    await openNavigation()
    await user.keyboard("{Escape}")
    await expectNavigationClosed()
    expect(await openNavigation()).toBeVisible()
  })

  it("hides preserved workspace drawers instead of allowing them to cover settings", async () => {
    render(
      <InAppSettings>
        <Drawer open swipeDirection="right">
          <DrawerContent>
            <DrawerTitle>Workspace panel</DrawerTitle>
            <input aria-label="Panel draft" defaultValue="Panel state" />
          </DrawerContent>
        </Drawer>
      </InAppSettings>
    )
    const panel = await screen.findByRole("dialog", {
      name: "Workspace panel",
    })
    const viewport = panel.closest('[data-slot="drawer-viewport"]')
    const panelDraft = screen.getByLabelText("Panel draft")
    openSettings()
    await screen.findByLabelText("General draft")
    expect(viewport).toHaveAttribute("inert")
    expect(viewport).toHaveClass("conversation-tab-hidden", "invisible")
    expect(panelDraft).toBeInTheDocument()
    const navigation = await openNavigation()
    expect(
      navigation.closest('[data-slot="drawer-viewport"]')
    ).not.toHaveAttribute("inert")
    fireEvent.click(screen.getByRole("button", { name: "backToApp" }))
    expect(viewport).not.toHaveAttribute("inert")
    expect(viewport).not.toHaveClass("invisible")
    expect(screen.getByLabelText("Panel draft")).toBe(panelDraft)
    expect(panelDraft).toHaveValue("Panel state")
  })

  it("keeps standalone mobile category navigation and remote workspace context", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/general?remoteConnectionId=3"
    )
    render(
      <SettingsShell>
        <div>Standalone settings</div>
      </SettingsShell>
    )
    fireEvent.click(screen.getByRole("button"))
    const navigation = await screen.findByRole("dialog", { name: "title" })
    fireEvent.click(
      within(navigation).getByRole("button", { name: "nav.appearance" })
    )
    expect(runtime.push).toHaveBeenCalledWith(
      "/settings/appearance?remoteConnectionId=3"
    )
    await expectNavigationClosed()
  })

  it("keeps desktop categories in the sidebar without a mobile menu", async () => {
    runtime.mobile = false
    render(
      <InAppSettings>
        <div>Workspace</div>
      </InAppSettings>
    )
    openSettings()
    await screen.findByLabelText("General draft")
    expect(screen.queryByRole("button", { name: "title" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "nav.appearance" }))
    expect(await screen.findByText("Appearance loaded")).toBeVisible()
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
