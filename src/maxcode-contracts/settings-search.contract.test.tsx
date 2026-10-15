import { useState, type ReactNode } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsShell } from "@/components/settings/settings-shell"
import { InAppSettings } from "@/components/settings/in-app-settings"
import { SettingRow } from "@/components/shared/setting-card"
import { SettingsSection } from "@/components/shared/settings-section"
import { SETTINGS_SEARCH_ENTRIES } from "@/components/settings/settings-search"
import { requestInAppSettings } from "@/lib/in-app-settings"
import { source } from "./contract-source"
import en from "@/i18n/messages/en.json"
import zh from "@/i18n/messages/zh-CN.json"

const runtime = vi.hoisted(() => ({
  mobile: false,
  web: true,
  pathname: "/settings/general",
  push: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => runtime.pathname,
  useRouter: () => ({ push: runtime.push }),
}))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => runtime.mobile }))
vi.mock("@/lib/transport/detect", () => ({
  detectEnvironment: () => (runtime.web ? "web" : "electron"),
}))
vi.mock("@/components/layout/app-title-bar", () => ({
  AppTitleBar: ({ left }: { left?: ReactNode }) => <header>{left}</header>,
}))
vi.mock("@/components/ui/app-toaster", () => ({ AppToaster: () => null }))
vi.mock("@/app/settings/general/page", () => ({
  default: () => (
    <>
      <input aria-label="Unsubmitted setting" defaultValue="Keep this draft" />
      <SettingRow title="Default Terminal">
        <input aria-label="Shell path" />
      </SettingRow>
    </>
  ),
}))
vi.mock("@/app/settings/system/page", () => ({
  default: () => (
    <SettingsSection title="Network Proxy">
      <input aria-label="Proxy address" defaultValue="" />
    </SettingsSection>
  ),
}))

beforeEach(() => {
  runtime.mobile = false
  runtime.web = true
  runtime.pathname = "/settings/general"
  runtime.push.mockClear()
  window.history.replaceState(
    null,
    "",
    "/settings/general?remoteConnectionId=3"
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mount(children?: ReactNode, locale: "en" | "zh-CN" = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <SettingsShell>{children}</SettingsShell>
    </NextIntlClientProvider>
  )
}
function search(query: string) {
  fireEvent.change(
    screen.getByRole("textbox", { name: /Search settings|搜索设置/ }),
    { target: { value: query } }
  )
}
function searchResult(label: string) {
  return within(screen.getByRole("navigation")).getByRole("button", {
    name: new RegExp(label),
  })
}
function lookup(messages: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (value, part) => (value as Record<string, unknown>)?.[part],
      messages
    )
}

describe("MaxCode: search concrete settings and reveal the result", () => {
  it("indexes translated labels and descriptions in all ten locales, with only maintained agents", () => {
    for (const locale of [
      "en",
      "zh-CN",
      "zh-TW",
      "ja",
      "ko",
      "de",
      "es",
      "fr",
      "pt",
      "ar",
    ]) {
      const messages = JSON.parse(source(`src/i18n/messages/${locale}.json`))
      for (const entry of SETTINGS_SEARCH_ENTRIES) {
        for (const key of [entry.titleKey, entry.descriptionKey].filter(
          Boolean
        )) {
          expect(lookup(messages, key!), `${locale}: ${key}`).toBeTypeOf(
            "string"
          )
        }
      }
    }
    expect(
      SETTINGS_SEARCH_ENTRIES.filter((entry) => entry.agentType).map(
        (entry) => entry.agentType
      )
    ).toEqual([
      "claude_code",
      "codex",
      "grok",
      "pi",
      "deepseek",
      "antigravity",
      "zcode",
    ])
    expect(new Set(SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id)).size).toBe(
      SETTINGS_SEARCH_ENTRIES.length
    )
  })

  it.each(["Default Terminal", "shell", "ANSI"])(
    "matches option names, descriptions and keywords: %s",
    (query) => {
      mount()
      search(query)
      expect(
        searchResult(
          query === "ANSI" ? "Colorize command output" : "Default Terminal"
        )
      ).toBeVisible()
    }
  )

  it("finds Chinese options and keeps advanced/desktop-only entries hidden on the web", () => {
    mount(undefined, "zh-CN")
    search("代理")
    expect(searchResult("网络代理")).toBeVisible()
    for (const query of [
      "壁纸",
      "MCP",
      "OpenCode",
      "启动登录项",
      "Access Token",
    ]) {
      search(query)
      expect(screen.getByRole("status")).toHaveTextContent(
        zh.SettingsShell.searchEmpty
      )
    }
  })

  it("shows an empty state and Escape restores navigation", () => {
    mount()
    search("no-such-setting-481")
    expect(screen.getByRole("status")).toHaveTextContent(
      en.SettingsShell.searchEmpty
    )
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })
    expect(screen.getByRole("button", { name: "General" })).toBeVisible()
  })

  it("preserves remote context and uses a query parameter for direct navigation", () => {
    mount()
    search("Network Proxy")
    fireEvent.click(searchResult("Network Proxy"))
    expect(runtime.push).toHaveBeenCalledWith(
      "/settings/system?remoteConnectionId=3&setting=proxy"
    )
  })

  it("Enter opens the first result but IME confirmation does not navigate", () => {
    mount()
    search("Network Proxy")
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      isComposing: true,
    })
    expect(runtime.push).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    expect(runtime.push).toHaveBeenCalledOnce()
  })

  it("focuses and highlights the visible matching option without editing its control", async () => {
    const changed = vi.fn()
    mount(
      <>
        <div hidden>
          <SettingRow title="Default Terminal">
            <input defaultValue="Hidden draft" />
          </SettingRow>
        </div>
        <SettingRow title="Default Terminal" description="Visible setting">
          <input aria-label="Terminal" defaultValue="zsh" onChange={changed} />
        </SettingRow>
      </>
    )
    search("Default Terminal")
    fireEvent.click(searchResult("Default Terminal"))
    const row = screen.getByLabelText("Terminal").closest("[data-setting-row]")!
    await waitFor(() =>
      expect(row).toHaveAttribute("data-settings-search-highlight")
    )
    expect(row).toHaveFocus()
    expect(screen.getByLabelText("Terminal")).toHaveValue("zsh")
    expect(changed).not.toHaveBeenCalled()
    expect(
      document.querySelector("[hidden] [data-settings-search-highlight]")
    ).toBeNull()
  })

  it("waits for loading content and restores a direct link after a full page load", async () => {
    window.history.replaceState(null, "", "/settings/general?setting=terminal")
    const Page = () => {
      const [ready, setReady] = useState(false)
      return (
        <>
          <button onClick={() => setReady(true)}>Finish loading</button>
          {ready && (
            <SettingRow title="Default Terminal">
              <input aria-label="Loaded control" />
            </SettingRow>
          )}
        </>
      )
    }
    mount(<Page />)
    fireEvent.click(screen.getByRole("button", { name: "Finish loading" }))
    await waitFor(() =>
      expect(
        screen.getByLabelText("Loaded control").closest("[data-setting-row]")
      ).toHaveAttribute("data-settings-search-highlight")
    )
  })

  it("opens a matching collapsed section without toggling its setting", async () => {
    const toggle = vi.fn()
    function Page() {
      const [open, setOpen] = useState(false)
      return (
        <SettingsSection
          title="Desktop notifications"
          collapsible
          open={open}
          onOpenChange={setOpen}
          control={
            <button
              role="switch"
              aria-checked="true"
              aria-label="Notifications enabled"
              onClick={toggle}
            />
          }
        >
          <div>Notification options</div>
        </SettingsSection>
      )
    }
    mount(<Page />)
    search("Desktop notifications")
    fireEvent.click(searchResult("Desktop notifications"))
    expect(await screen.findByText("Notification options")).toBeVisible()
    expect(toggle).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    "searches across in-window pages and keeps drafts (mobile=%s)",
    async (mobile) => {
      runtime.mobile = mobile
      window.history.replaceState(null, "", "/workspace?conversation=7")
      render(
        <NextIntlClientProvider locale="en" messages={en}>
          <InAppSettings>
            <textarea aria-label="Workspace draft" defaultValue="Unsent" />
          </InAppSettings>
        </NextIntlClientProvider>
      )
      act(() => {
        requestInAppSettings({ section: "general" })
      })
      const draft = await screen.findByLabelText("Unsubmitted setting")
      fireEvent.change(draft, { target: { value: "My unsaved edit" } })
      if (mobile)
        await userEvent
          .setup()
          .click(screen.getByRole("button", { name: "Settings" }))
      search("Network Proxy")
      fireEvent.click(searchResult("Network Proxy"))
      const proxy = await screen.findByLabelText("Proxy address")
      await waitFor(() =>
        expect(proxy.closest("[data-settings-section]")).toHaveAttribute(
          "data-settings-search-highlight"
        )
      )
      expect(draft).toHaveValue("My unsaved edit")
      expect(draft).not.toBeVisible()
      expect(runtime.push).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole("button", { name: "Back to app" }))
      expect(screen.getByLabelText("Workspace draft")).toHaveValue("Unsent")
      expect(window.location.search).toBe("?conversation=7")
    }
  )
})
