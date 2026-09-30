import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { WebServiceSettings } from "@/components/settings/web-service-settings"

const h = vi.hoisted(() => ({
  config: {
    port: 3080,
    token: "token",
    autoStart: false,
    publicShareUrl: "https://old.example.com",
  },
  update: vi.fn(),
  status: vi.fn(),
  copy: vi.fn(),
}))
vi.mock("@/lib/api", () => ({
  getWebServiceConfig: async () => h.config,
  getWebServerStatus: () => h.status(),
  probeWebServicePort: async () => null,
  updateWebServiceConfig: (config: typeof h.config) => h.update(config),
  startWebServer: vi.fn(),
  stopWebServer: vi.fn(),
}))
vi.mock("@/lib/platform", () => ({ openUrl: vi.fn() }))
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  copyTextToClipboard: (text: string) => h.copy(text),
}))

beforeEach(() => {
  h.config = {
    port: 3080,
    token: "token",
    autoStart: false,
    publicShareUrl: "https://old.example.com",
  }
  h.update.mockReset().mockImplementation(async (config) => {
    h.config = config
    return config
  })
  h.status.mockReset().mockResolvedValue(null)
  h.copy.mockReset().mockResolvedValue(true)
})
afterEach(cleanup)

async function setup() {
  const view = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WebServiceSettings />
    </NextIntlClientProvider>
  )
  const input = view.getByRole("textbox", { name: "Public share URL" })
  await waitFor(() => expect(input).toHaveValue("https://old.example.com"))
  return { ...view, input }
}

describe("MaxCode contract: explicit public share URL save", () => {
  it("keeps drafts out of auto-save and persists them only on Save", async () => {
    const view = await setup()
    fireEvent.change(view.input, {
      target: { value: "https://new.example.com/" },
    })
    await waitFor(() => expect(h.update).toHaveBeenCalled(), { timeout: 1500 })
    expect(h.config.publicShareUrl).toBe("https://old.example.com")
    fireEvent.click(view.getByRole("button", { name: "Save" }))
    await view.findByText("Saved")
    expect(h.config.publicShareUrl).toBe("https://new.example.com")
  })

  it("reports invalid URLs and failed writes without claiming success, then permits retry", async () => {
    const view = await setup()
    fireEvent.change(view.input, { target: { value: "invalid" } })
    fireEvent.click(view.getByRole("button", { name: "Save" }))
    await view.findByText(enMessages.WebServiceSettings.publicShareUrlInvalid)
    expect(h.config.publicShareUrl).toBe("https://old.example.com")
    fireEvent.change(view.input, {
      target: { value: "https://new.example.com" },
    })
    h.update.mockRejectedValueOnce(new Error("failed"))
    fireEvent.click(view.getByRole("button", { name: "Save" }))
    await view.findByText(enMessages.WebServiceSettings.saveConfigFailed)
    expect(view.queryByText("Saved")).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Save" }))
    await view.findByText("Saved")
  })
})

describe("MaxCode contract: Web service token input controls", () => {
  it("allows editing, regeneration, reveal and copy in the shared input group", async () => {
    const view = await setup()
    const input = view.getByLabelText("Access Token")
    expect(input).toHaveAttribute("type", "password")
    expect(input).toHaveValue("token")

    fireEvent.change(input, { target: { value: "edited-token" } })
    expect(input).toHaveValue("edited-token")
    fireEvent.click(view.getByRole("button", { name: "Show" }))
    expect(input).toHaveAttribute("type", "text")
    fireEvent.click(view.getByRole("button", { name: "Copy" }))
    await waitFor(() => expect(h.copy).toHaveBeenCalledWith("edited-token"))
    fireEvent.click(view.getByRole("button", { name: "Hide" }))
    expect(input).toHaveAttribute("type", "password")

    fireEvent.click(view.getByRole("button", { name: "Regenerate" }))
    expect((input as HTMLInputElement).value).toMatch(/^[a-f0-9]{32}$/)
    fireEvent.change(input, { target: { value: "" } })
    expect(view.getByRole("button", { name: "Copy" })).toBeDisabled()
  })

  it("locks edits for a running service while keeping reveal and copy usable", async () => {
    h.status.mockResolvedValue({
      port: 3080,
      token: "running-token",
      addresses: [],
    })
    const view = await setup()
    const input = view.getByLabelText("Access Token")
    expect(input).toBeDisabled()
    expect(input).toHaveValue("running-token")
    expect(view.queryByRole("button", { name: "Regenerate" })).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Show" }))
    expect(input).toHaveAttribute("type", "text")
    fireEvent.click(view.getByRole("button", { name: "Copy" }))
    await waitFor(() => expect(h.copy).toHaveBeenCalledWith("running-token"))
  })
})
