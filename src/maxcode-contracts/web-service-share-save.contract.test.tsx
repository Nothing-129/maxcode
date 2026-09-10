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
}))
vi.mock("@/lib/api", () => ({
  getWebServiceConfig: async () => h.config,
  getWebServerStatus: async () => null,
  probeWebServicePort: async () => null,
  updateWebServiceConfig: (config: typeof h.config) => h.update(config),
  startWebServer: vi.fn(),
  stopWebServer: vi.fn(),
}))
vi.mock("@/lib/platform", () => ({ openUrl: vi.fn() }))

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
