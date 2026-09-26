import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

const transportCall = vi.fn()

vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: transportCall }),
  isDesktop: () => false,
  isRemoteDesktopMode: () => false,
  getActiveRemoteConnectionId: () => null,
}))

vi.mock("@/lib/api", () => ({
  getSystemProxySettings: vi.fn(),
  getSystemTitleModelSettings: vi.fn(),
  updateSystemProxySettings: vi.fn(),
  updateSystemTitleModelSettings: vi.fn(),
  testSystemTitleModelSettings: vi.fn(),
  updateSystemLanguageSettings: vi.fn(),
  listenBackupProgress: vi.fn(async () => () => {}),
  listSafetySnapshots: vi.fn(async () => []),
  exportBackupDesktop: vi.fn(),
  exportBackupWeb: vi.fn(),
  prepareBackupSourceDesktop: vi.fn(),
  prepareBackupSourceWeb: vi.fn(),
  releaseBackupSource: vi.fn(),
  scanExternalConflicts: vi.fn(),
  backupActiveAgents: vi.fn(async () => []),
  cancelBackup: vi.fn(),
  discardPendingRestore: vi.fn(),
  rollbackToSnapshot: vi.fn(),
  stageRestoreDesktop: vi.fn(),
  stageRestoreWeb: vi.fn(),
  uploadBackupWeb: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}))

vi.mock("@/lib/platform", () => ({ openUrl: vi.fn() }))

vi.mock("@/components/i18n-provider", () => ({
  useAppI18n: () => ({
    languageSettings: { mode: "system", language: "en" },
    languageSettingsLoaded: true,
    setLanguageSettings: vi.fn(),
  }),
}))

import { SystemNetworkSettings } from "./system-network-settings"
import arMessages from "@/i18n/messages/ar.json"
import deMessages from "@/i18n/messages/de.json"
import enMessages from "@/i18n/messages/en.json"
import esMessages from "@/i18n/messages/es.json"
import frMessages from "@/i18n/messages/fr.json"
import jaMessages from "@/i18n/messages/ja.json"
import koMessages from "@/i18n/messages/ko.json"
import ptMessages from "@/i18n/messages/pt.json"
import zhCNMessages from "@/i18n/messages/zh-CN.json"
import zhTWMessages from "@/i18n/messages/zh-TW.json"
import { openUrl } from "@/lib/platform"
import {
  getSystemProxySettings,
  updateSystemProxySettings,
  getSystemTitleModelSettings,
  testSystemTitleModelSettings,
  updateSystemTitleModelSettings,
} from "@/lib/api"

const mockGetProxy = vi.mocked(getSystemProxySettings)
const mockGetTitleModel = vi.mocked(getSystemTitleModelSettings)
const mockSetTitleModel = vi.mocked(updateSystemTitleModelSettings)
const mockTestTitleModel = vi.mocked(testSystemTitleModelSettings)
const mockOpenUrl = vi.mocked(openUrl)
const mockSetProxy = vi.mocked(updateSystemProxySettings)

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SystemNetworkSettings />
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  transportCall.mockReset()
  mockGetProxy.mockReset()
  mockSetProxy.mockReset()
  mockGetTitleModel.mockReset()
  mockSetTitleModel.mockReset()
  mockTestTitleModel.mockReset()
  mockOpenUrl.mockReset()
  mockGetTitleModel.mockResolvedValue({
    enabled: true,
    base_url: "https://api.groq.com/openai/v1",
    model: "qwen/qwen3.8-27b",
    api_key_configured: false,
    request_params: [{ key: "reasoning_effort", value: "none" }],
  })
})

it("loads system settings without exposing or checking for updates", async () => {
  mockGetProxy.mockResolvedValue({
    enabled: true,
    proxy_url: "http://proxy.local:8080",
  })

  renderWithIntl()

  expect(
    await screen.findByDisplayValue("http://proxy.local:8080")
  ).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: "Check for updates" })
  ).not.toBeInTheDocument()
  expect(screen.queryByText("Version & Updates")).not.toBeInTheDocument()
  expect(transportCall).not.toHaveBeenCalled()
})

it("keeps network settings available without the retired launch-at-login switch", async () => {
  mockGetProxy.mockResolvedValue({ enabled: false, proxy_url: null })
  renderWithIntl()
  await screen.findByRole("heading", { name: "Network Proxy" })
  expect(screen.queryByLabelText("Launch at login")).not.toBeInTheDocument()
})

describe("SystemNetworkSettings — conversation title model", () => {
  beforeEach(() => {
    mockGetProxy.mockResolvedValue({ enabled: false, proxy_url: null })
  })

  it("lets an unconfigured user paste only a free Groq key and save", async () => {
    mockSetTitleModel.mockResolvedValue({
      enabled: true,
      base_url: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3.8-27b",
      api_key_configured: true,
      request_params: [{ key: "reasoning_effort", value: "none" }],
    })

    renderWithIntl()

    const section = (
      await screen.findByRole("heading", {
        name: "Conversation Title Model",
      })
    ).closest("section")
    expect(section).not.toBeNull()
    expect(
      within(section!).getByLabelText("Use a dedicated title model")
    ).toBeChecked()
    expect(
      within(section!).getByDisplayValue("https://api.groq.com/openai/v1")
    ).toBeInTheDocument()
    expect(
      within(section!).getByDisplayValue("qwen/qwen3.8-27b")
    ).toBeInTheDocument()
    expect(
      within(section!).getByPlaceholderText("Paste your Groq API Key")
    ).toBeInTheDocument()
    expect(
      within(section!).getByLabelText("Request parameter 1 key")
    ).toHaveValue("reasoning_effort")
    expect(
      within(section!).getByLabelText("Request parameter 1 value")
    ).toHaveValue("none")

    const signup = within(section!).getByRole("link", {
      name: /free Groq account/i,
    })
    expect(signup).toHaveAttribute("href", "https://console.groq.com/keys")
    fireEvent.click(signup)
    expect(mockOpenUrl).toHaveBeenCalledWith("https://console.groq.com/keys")

    fireEvent.change(within(section!).getByLabelText("API Key"), {
      target: { value: "user-groq-key" },
    })
    fireEvent.click(within(section!).getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(mockSetTitleModel).toHaveBeenCalledWith({
        enabled: true,
        base_url: "https://api.groq.com/openai/v1",
        model: "qwen/qwen3.8-27b",
        api_key: "user-groq-key",
        clear_api_key: false,
        request_params: [{ key: "reasoning_effort", value: "none" }],
      })
    )
  })

  it("loads a secret-free view and saves an OpenAI-compatible model", async () => {
    mockGetTitleModel.mockResolvedValue({
      enabled: true,
      base_url: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3.6-27b",
      api_key_configured: true,
      request_params: [{ key: "enable_thinking", value: "false" }],
    })
    mockSetTitleModel.mockResolvedValue({
      enabled: true,
      base_url: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3.6-27b",
      api_key_configured: true,
      request_params: [{ key: "enable_thinking", value: "false" }],
    })

    renderWithIntl()

    expect(
      await screen.findByDisplayValue("https://api.groq.com/openai/v1")
    ).toBeInTheDocument()
    expect(screen.getByLabelText("API Key")).toHaveValue("")
    expect(screen.getByPlaceholderText(/leave blank/i)).toBeInTheDocument()
    expect(screen.getByLabelText("Request parameter 1 key")).toHaveValue(
      "enable_thinking"
    )
    expect(screen.getByLabelText("Request parameter 1 value")).toHaveValue(
      "false"
    )

    const section = screen
      .getByRole("heading", { name: "Conversation Title Model" })
      .closest("section")
    expect(section).not.toBeNull()
    fireEvent.click(within(section!).getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(mockSetTitleModel).toHaveBeenCalledWith({
        enabled: true,
        base_url: "https://api.groq.com/openai/v1",
        model: "qwen/qwen3.6-27b",
        api_key: null,
        clear_api_key: false,
        request_params: [{ key: "enable_thinking", value: "false" }],
      })
    )
  })

  it("tests the current draft without creating a second desktop-only configuration", async () => {
    mockGetTitleModel.mockResolvedValue({
      enabled: true,
      base_url: "https://api.groq.com/openai/v1",
      model: "qwen/qwen3.6-27b",
      api_key_configured: true,
      request_params: [],
    })
    mockTestTitleModel.mockResolvedValue({
      title: "Fix session titles",
      latency_ms: 84,
    })

    renderWithIntl()

    const section = (
      await screen.findByRole("heading", {
        name: "Conversation Title Model",
      })
    ).closest("section")
    expect(section).not.toBeNull()
    fireEvent.click(
      within(section!).getByRole("button", { name: "Add parameter" })
    )
    fireEvent.change(
      within(section!).getByLabelText("Request parameter 1 key"),
      { target: { value: "reasoning_effort" } }
    )
    fireEvent.change(
      within(section!).getByLabelText("Request parameter 1 value"),
      { target: { value: "none" } }
    )
    fireEvent.click(within(section!).getByRole("button", { name: "Test" }))

    await waitFor(() =>
      expect(mockTestTitleModel).toHaveBeenCalledWith({
        enabled: true,
        base_url: "https://api.groq.com/openai/v1",
        model: "qwen/qwen3.6-27b",
        api_key: null,
        clear_api_key: false,
        request_params: [{ key: "reasoning_effort", value: "none" }],
      })
    )
    expect(
      await within(section!).findByText(/Fix session titles.*84 ms/)
    ).toBeInTheDocument()
  })
})

describe("SystemNetworkSettings — proxy bypass list", () => {
  it("saves the list with the proxy and shows what the backend stored", async () => {
    mockGetProxy.mockResolvedValue({
      enabled: true,
      proxy_url: "http://10.0.0.2:3128",
      no_proxy: "corp.example.com",
    })
    // The backend canonicalizes the list; the field follows its answer.
    mockSetProxy.mockResolvedValue({
      enabled: true,
      proxy_url: "http://10.0.0.2:3128",
      no_proxy: "corp.example.com,192.168.1.10",
    })

    renderWithIntl()

    const bypass = await screen.findByLabelText("Bypass proxy for")
    expect(bypass).toHaveValue("corp.example.com")

    fireEvent.change(bypass, {
      target: { value: " corp.example.com;192.168.1.10 " },
    })
    fireEvent.blur(bypass)

    await waitFor(() =>
      expect(bypass).toHaveValue("corp.example.com,192.168.1.10")
    )
    expect(mockSetProxy).toHaveBeenCalledWith({
      enabled: true,
      proxy_url: "http://10.0.0.2:3128",
      no_proxy: "corp.example.com;192.168.1.10",
    })
  })

  it("keeps the list when the proxy address or switch is saved", async () => {
    // Every save sends the whole settings row, so saving one field must not
    // wipe the bypass list the backend already has.
    mockGetProxy.mockResolvedValue({
      enabled: false,
      proxy_url: "http://10.0.0.2:3128",
      no_proxy: "corp.example.com",
    })
    mockSetProxy.mockImplementation(async (settings) => settings)

    renderWithIntl()

    const address = await screen.findByDisplayValue("http://10.0.0.2:3128")
    fireEvent.blur(address)
    await waitFor(() => expect(mockSetProxy).toHaveBeenCalledTimes(1))
    expect(mockSetProxy).toHaveBeenLastCalledWith({
      enabled: false,
      proxy_url: "http://10.0.0.2:3128",
      no_proxy: "corp.example.com",
    })

    fireEvent.click(screen.getByLabelText("Enable system proxy"))
    await waitFor(() => expect(mockSetProxy).toHaveBeenCalledTimes(2))
    expect(mockSetProxy).toHaveBeenLastCalledWith({
      enabled: true,
      proxy_url: "http://10.0.0.2:3128",
      no_proxy: "corp.example.com",
    })
  })

  it("clears the list with an empty field", async () => {
    mockGetProxy.mockResolvedValue({
      enabled: true,
      proxy_url: "http://10.0.0.2:3128",
      no_proxy: "corp.example.com",
    })
    mockSetProxy.mockImplementation(async (settings) => settings)

    renderWithIntl()

    const bypass = await screen.findByLabelText("Bypass proxy for")
    fireEvent.change(bypass, { target: { value: "   " } })
    fireEvent.blur(bypass)

    await waitFor(() => expect(mockSetProxy).toHaveBeenCalledTimes(1))
    expect(mockSetProxy).toHaveBeenCalledWith({
      enabled: true,
      proxy_url: "http://10.0.0.2:3128",
      no_proxy: null,
    })
    await waitFor(() => expect(bypass).toHaveValue(""))
  })

  it("states the list format with the same literals as the placeholder", async () => {
    mockGetProxy.mockResolvedValue({
      enabled: false,
      proxy_url: null,
      no_proxy: null,
    })

    renderWithIntl()

    const bypass = await screen.findByLabelText("Bypass proxy for")
    const example = bypass.getAttribute("placeholder") ?? ""
    // The form the backend stores and shows back: commas, no spaces.
    expect(example).toMatch(/^[^\s,]+(,[^\s,]+)+$/)
    // Hosts read left to right even in Arabic.
    expect(bypass).toHaveAttribute("dir", "ltr")

    const hint = screen.getByText(/Separate entries with commas and no spaces/)
    for (const literal of [
      example,
      "example.com",
      ".example.com",
      "localhost,127.0.0.1,::1",
    ]) {
      const node = within(hint).getByText(literal)
      expect(node.tagName).toBe("CODE")
      // Kept whole in Arabic, where a leading `.` would otherwise move.
      expect(node).toHaveAttribute("dir", "ltr")
    }
  })

  it("shows an empty list for a server that predates the setting", async () => {
    // A remote workspace on an older server never sends `no_proxy`.
    mockGetProxy.mockResolvedValue({
      enabled: true,
      proxy_url: "http://10.0.0.2:3128",
    })

    renderWithIntl()

    expect(await screen.findByLabelText("Bypass proxy for")).toHaveValue("")
    expect(screen.queryByText(/Load failed/)).not.toBeInTheDocument()
  })
})

describe("SystemNetworkSettings — proxy bypass hint in every locale", () => {
  it.each([
    ["ar", arMessages],
    ["de", deMessages],
    ["en", enMessages],
    ["es", esMessages],
    ["fr", frMessages],
    ["ja", jaMessages],
    ["ko", koMessages],
    ["pt", ptMessages],
    ["zh-CN", zhCNMessages],
    ["zh-TW", zhTWMessages],
  ] as const)(
    "%s writes every value the way the field takes it",
    (_, messages) => {
      const hint = messages.SystemSettings.proxyBypassHint
      for (const literal of [
        "{example}",
        "example.com",
        ".example.com",
        "localhost,127.0.0.1,::1",
      ]) {
        expect(hint).toContain(`<code>${literal}</code>`)
      }
      // The local hosts appear once, as that literal — never listed with the
      // locale's own punctuation (、 ، or ", "), which reads as a separator.
      expect(hint.split("localhost")).toHaveLength(2)
    }
  )
})
