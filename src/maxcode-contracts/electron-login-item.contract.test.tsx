import { createRequire } from "node:module"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LoginItemSettingsSection } from "@/components/settings/login-item-settings"
import { source } from "./contract-source"

const require = createRequire(import.meta.url)
const { createLoginItem } = require("../../electron/login-item.cjs")
vi.mock("next-intl", () => ({ useTranslations: () => translate }))
const translate = (key: string) => key
const off = { supported: true, enabled: false, needsApproval: false }
const on = { ...off, enabled: true }
function bridge(
  get = vi.fn().mockResolvedValue(off),
  set = vi.fn().mockResolvedValue(on)
) {
  Object.defineProperty(window, "maxcodeElectron", {
    configurable: true,
    value: { getLoginItem: get, setLoginItem: set },
  })
  return { get, set }
}
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, "maxcodeElectron")
})

describe("MaxCode contract: native Electron launch at login", () => {
  it.each(["darwin", "win32"])(
    "registers and removes the installed %s app, reading back OS state",
    (platform) => {
      let enabled = false
      const app = {
        isPackaged: true,
        getLoginItemSettings: vi.fn(() => ({
          openAtLogin: enabled,
          executableWillLaunchAtLogin: enabled,
        })),
        setLoginItemSettings: vi.fn((settings) => {
          enabled = settings.openAtLogin
        }),
      }
      const item = createLoginItem(
        app,
        platform,
        "C:\\Program Files\\MaxCode\\maxcode.exe"
      )
      expect(item.get()).toEqual(off)
      expect(app.setLoginItemSettings).not.toHaveBeenCalled()
      expect(item.set(true)).toEqual(on)
      expect(item.set(false)).toEqual(off)
      expect(() => item.set("true")).toThrow("boolean")
      if (platform === "win32") {
        expect(app.setLoginItemSettings).toHaveBeenCalledWith({
          path: "C:\\Program Files\\MaxCode\\maxcode.exe",
          args: [],
          openAtLogin: true,
        })
        expect(app.getLoginItemSettings).toHaveBeenCalledWith({
          path: "C:\\Program Files\\MaxCode\\maxcode.exe",
          args: [],
        })
      }
    }
  )

  it.each([
    [false, "darwin"],
    [true, "linux"],
  ])("never registers unsupported builds (%s/%s)", (isPackaged, platform) => {
    const app = {
      isPackaged,
      getLoginItemSettings: vi.fn(),
      setLoginItemSettings: vi.fn(),
    }
    const item = createLoginItem(app, platform)
    expect(item.get().supported).toBe(false)
    expect(() => item.set(true)).toThrow("packaged")
    expect(app.getLoginItemSettings).not.toHaveBeenCalled()
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it("exposes pending system approval and rejects silent registration failures", () => {
    const app = {
      isPackaged: true,
      getLoginItemSettings: vi.fn(() => ({
        openAtLogin: false,
        status: "requires-approval",
      })),
      setLoginItemSettings: vi.fn(),
    }
    expect(createLoginItem(app, "darwin").set(true)).toEqual({
      ...on,
      needsApproval: true,
    })
    app.getLoginItemSettings.mockReturnValue({
      openAtLogin: false,
      status: "not-registered",
    })
    expect(() => createLoginItem(app, "darwin").set(true)).toThrow(
      "did not apply"
    )
    app.getLoginItemSettings.mockReturnValue({ openAtLogin: true, status: "" })
    expect(createLoginItem(app, "win32").get().needsApproval).toBe(true)
  })

  it("hides the control in browsers and unsupported desktop builds", async () => {
    const view = render(<LoginItemSettingsSection />)
    expect(screen.queryByRole("switch")).toBeNull()
    bridge(vi.fn().mockResolvedValue({ ...off, supported: false }))
    view.rerender(<LoginItemSettingsSection />)
    await waitFor(() => expect(screen.queryByRole("switch")).toBeNull())
  })

  it("saves both directions and refreshes changes made in system settings", async () => {
    const { get, set } = bridge()
    render(<LoginItemSettingsSection />)
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled())
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked())
    expect(set).toHaveBeenCalledWith(true)
    set.mockResolvedValue(off)
    fireEvent.click(screen.getByRole("switch"))
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked())
    expect(set).toHaveBeenCalledWith(false)
    get.mockResolvedValue({ ...on, needsApproval: true })
    fireEvent.focus(window)
    await screen.findByText("needsApproval")
    expect(screen.getByRole("switch")).toBeChecked()
  })

  it("retains authoritative state after a failed save and prevents concurrent writes", async () => {
    let reject!: (reason: Error) => void
    const { set } = bridge(
      undefined,
      vi.fn(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail
          })
      )
    )
    render(<LoginItemSettingsSection />)
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled())
    fireEvent.click(screen.getByRole("switch"))
    expect(screen.getByRole("switch")).toBeDisabled()
    fireEvent.click(screen.getByRole("switch"))
    expect(set).toHaveBeenCalledTimes(1)
    reject(new Error("OS refused"))
    await screen.findByText("saveFailed")
    expect(screen.getByRole("switch")).not.toBeChecked()
  })

  it("reports load failures and retries on focus", async () => {
    const { get } = bridge(vi.fn().mockRejectedValue(new Error("unavailable")))
    render(<LoginItemSettingsSection />)
    await screen.findByText("loadFailed")
    expect(screen.getByRole("switch")).toBeDisabled()
    get.mockResolvedValue(off)
    fireEvent.focus(window)
    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled())
  })

  it("wires the narrow bridge through the checked IPC handler and General settings", () => {
    expect(source("electron/main.cjs")).toContain(
      'handle("login-item-set", (_window, enabled) => loginItem.set(enabled))'
    )
    expect(source("electron/main.cjs")).toContain(
      'if (!trustedSender(event)) throw new Error("Untrusted desktop IPC sender")'
    )
    expect(source("electron/preload.cjs")).toContain(
      'ipcRenderer.invoke("maxcode:login-item-set", enabled)'
    )
    expect(source("src/components/settings/general-settings.tsx")).toContain(
      "<LoginItemSettingsSection />"
    )
  })
})
