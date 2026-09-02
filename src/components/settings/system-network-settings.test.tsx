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
  getSystemAutostartSettings: vi.fn(),
  updateSystemAutostartSettings: vi.fn(),
  listenBackupProgress: vi.fn(async () => () => {}),
  exportBackupDesktop: vi.fn(),
  exportBackupWeb: vi.fn(),
  inspectBackupDesktop: vi.fn(),
  inspectBackupWeb: vi.fn(),
  scanExternalConflictsDesktop: vi.fn(),
  scanExternalConflictsWeb: vi.fn(),
  stageRestoreDesktop: vi.fn(),
  stageRestoreWeb: vi.fn(),
  uploadBackupWeb: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}))

// Launch at login only applies to the local desktop shell. Keep desktop and
// remote-workspace state separate so the remote-desktop regression is covered.
let desktopShell = false
let remoteWorkspace = false
vi.mock("@/lib/platform", () => ({
  openUrl: vi.fn(),
  isDesktop: () => desktopShell,
  isLocalDesktop: () => desktopShell && !remoteWorkspace,
}))

vi.mock("@/components/i18n-provider", () => ({
  useAppI18n: () => ({
    languageSettings: { mode: "system", language: "en" },
    languageSettingsLoaded: true,
    setLanguageSettings: vi.fn(),
  }),
}))

import { SystemNetworkSettings } from "./system-network-settings"
import enMessages from "@/i18n/messages/en.json"
import {
  getSystemAutostartSettings,
  getSystemProxySettings,
  getSystemTitleModelSettings,
  testSystemTitleModelSettings,
  updateSystemTitleModelSettings,
  updateSystemAutostartSettings,
} from "@/lib/api"

const mockGetProxy = vi.mocked(getSystemProxySettings)
const mockGetTitleModel = vi.mocked(getSystemTitleModelSettings)
const mockSetTitleModel = vi.mocked(updateSystemTitleModelSettings)
const mockTestTitleModel = vi.mocked(testSystemTitleModelSettings)
const mockGetAutostart = vi.mocked(getSystemAutostartSettings)
const mockSetAutostart = vi.mocked(updateSystemAutostartSettings)

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
  mockGetAutostart.mockReset()
  mockSetAutostart.mockReset()
  desktopShell = false
  remoteWorkspace = false
  mockGetTitleModel.mockResolvedValue({
    enabled: false,
    base_url: "",
    model: "",
    api_key_configured: false,
    request_params: [],
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

describe("SystemNetworkSettings — launch at login", () => {
  beforeEach(() => {
    mockGetProxy.mockResolvedValue({ enabled: false, proxy_url: null })
  })

  it("hides the section on a web build", async () => {
    mockGetAutostart.mockResolvedValue({ enabled: false })

    renderWithIntl()

    await screen.findByRole("heading", { name: "Network Proxy" })
    expect(screen.queryByLabelText("Launch at login")).not.toBeInTheDocument()
    expect(mockGetAutostart).not.toHaveBeenCalled()
  })

  it("hides the section in a remote-workspace window", async () => {
    desktopShell = true
    remoteWorkspace = true
    mockGetAutostart.mockResolvedValue({ enabled: false })

    renderWithIntl()

    await screen.findByRole("heading", { name: "Network Proxy" })
    expect(screen.queryByLabelText("Launch at login")).not.toBeInTheDocument()
    expect(mockGetAutostart).not.toHaveBeenCalled()
  })

  it("follows the OS's answer rather than the optimistic value", async () => {
    desktopShell = true
    mockGetAutostart.mockResolvedValue({ enabled: false })
    mockSetAutostart.mockResolvedValue({ enabled: false })

    renderWithIntl()

    const autostart = await screen.findByLabelText("Launch at login")
    expect(autostart).toHaveAttribute("role", "switch")
    expect(autostart).toHaveAttribute("data-state", "unchecked")

    fireEvent.click(autostart)
    await waitFor(() => expect(autostart).not.toBeDisabled())
    expect(mockSetAutostart).toHaveBeenCalledWith({ enabled: true })
    expect(autostart).toHaveAttribute("data-state", "unchecked")

    mockSetAutostart.mockResolvedValue({ enabled: true })
    fireEvent.click(autostart)
    await waitFor(() =>
      expect(autostart).toHaveAttribute("data-state", "checked")
    )
  })

  it("keeps the rest of the page alive when the OS won't report login items", async () => {
    desktopShell = true
    mockGetProxy.mockResolvedValue({
      enabled: true,
      proxy_url: "http://proxy.local:8080",
    })
    mockGetAutostart.mockRejectedValue(new Error("registry locked"))

    renderWithIntl()

    const autostart = await screen.findByLabelText("Launch at login")
    expect(autostart).toBeDisabled()
    expect(screen.getByText(/registry locked/)).toBeInTheDocument()
    expect(
      screen.getByDisplayValue("http://proxy.local:8080")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Load failed/)).not.toBeInTheDocument()
  })
})

describe("SystemNetworkSettings — conversation title model", () => {
  beforeEach(() => {
    mockGetProxy.mockResolvedValue({ enabled: false, proxy_url: null })
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
