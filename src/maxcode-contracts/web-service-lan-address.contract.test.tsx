import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import enMessages from "@/i18n/messages/en.json"
import { WebServiceSettings } from "@/components/settings/web-service-settings"

const h = vi.hoisted(() => ({
  status: vi.fn(),
  copy: vi.fn(),
  open: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  getWebServiceConfig: async () => ({
    port: 3086,
    token: "token",
    autoStart: false,
    publicShareUrl: null,
  }),
  getWebServerStatus: () => h.status(),
  probeWebServicePort: async () => null,
  updateWebServiceConfig: async (config: unknown) => config,
  startWebServer: vi.fn(),
  stopWebServer: vi.fn(),
}))
vi.mock("@/lib/platform", () => ({ openUrl: (url: string) => h.open(url) }))
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  copyTextToClipboard: (text: string) => h.copy(text),
}))

beforeEach(() => {
  window.localStorage.clear()
  h.status.mockReset().mockResolvedValue({
    port: 3086,
    token: "token",
    addresses: ["http://127.0.0.1:3086", "http://192.168.20.144:3086"],
  })
  h.copy.mockReset().mockResolvedValue(true)
  h.open.mockReset()
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

function setup() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WebServiceSettings />
    </NextIntlClientProvider>
  )
}

describe("MaxCode contract: Web service defaults to a LAN address", () => {
  it.each([null, "192.168.1.99"])(
    "uses LAN when the saved host is %s and keeps address actions consistent",
    async (savedHost) => {
      if (savedHost) {
        window.localStorage.setItem("webService.displayHost", savedHost)
      }
      setup()
      const selector = await screen.findByRole("combobox")
      await waitFor(() =>
        expect(selector).toHaveTextContent("http://192.168.20.144:3086")
      )
      fireEvent.click(screen.getByRole("button", { name: "Open" }))
      expect(h.open).toHaveBeenCalledWith("http://192.168.20.144:3086")
      fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[1])
      await waitFor(() =>
        expect(h.copy).toHaveBeenCalledWith("http://192.168.20.144:3086")
      )
      fireEvent.click(screen.getByRole("button", { name: "QR Code" }))
      expect(await screen.findByRole("dialog")).toHaveTextContent(
        "http://192.168.20.144:3086"
      )
    }
  )

  it.each([
    ["127.0.0.1", "http://127.0.0.1:3086"],
    ["192.168.20.144", "http://192.168.20.144:3086"],
  ])(
    "restores an explicit %s choice across port changes",
    async (host, url) => {
      window.localStorage.setItem("webService.displayHost", host)
      setup()
      await waitFor(() =>
        expect(screen.getByRole("combobox")).toHaveTextContent(url)
      )
    }
  )

  it("remembers a manually selected address on reopening settings", async () => {
    const user = userEvent.setup()
    const view = setup()
    const selector = await screen.findByRole("combobox")
    await user.click(selector)
    await user.click(
      screen.getByRole("option", { name: "http://127.0.0.1:3086" })
    )
    expect(selector).toHaveTextContent("http://127.0.0.1:3086")
    view.unmount()
    setup()
    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveTextContent(
        "http://127.0.0.1:3086"
      )
    )
  })

  it("falls back to the only advertised address without a LAN connection", async () => {
    h.status.mockResolvedValue({
      port: 3086,
      token: "token",
      addresses: ["http://127.0.0.1:3086"],
    })
    setup()
    expect(await screen.findByText("http://127.0.0.1:3086")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(h.open).toHaveBeenCalledWith("http://127.0.0.1:3086")
  })
})
