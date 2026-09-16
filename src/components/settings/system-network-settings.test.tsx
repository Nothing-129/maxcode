import {
  fireEvent,
  render,
  screen,
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
import enMessages from "@/i18n/messages/en.json"
import { openUrl } from "@/lib/platform"
import {
  getSystemProxySettings,
  getSystemTitleModelSettings,
  testSystemTitleModelSettings,
  updateSystemTitleModelSettings,
} from "@/lib/api"

const mockGetProxy = vi.mocked(getSystemProxySettings)
const mockGetTitleModel = vi.mocked(getSystemTitleModelSettings)
const mockSetTitleModel = vi.mocked(updateSystemTitleModelSettings)
const mockTestTitleModel = vi.mocked(testSystemTitleModelSettings)
const mockOpenUrl = vi.mocked(openUrl)

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
