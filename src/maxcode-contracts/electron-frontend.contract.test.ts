import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ElectronBridge } from "@/lib/electron"
import { source } from "./contract-source"
import { detectEnvironment } from "@/lib/transport/detect"
import { WebTransport } from "@/lib/transport/web-transport"
import { getCodegToken, redirectToCodegLogin } from "@/lib/transport/web-auth"
import {
  closeCurrentWindow,
  isLocalDesktop,
  openFileDialog,
  openPath,
  openUrl,
  revealItemInDir,
} from "@/lib/platform"
import {
  deliverSystemNotification,
  getNotificationPermission,
} from "@/lib/notification"
import { saveTextFile } from "@/lib/save-file"
import {
  checkAppUpdateInfo,
  getAppUpdateState,
  getCurrentAppVersion,
  getServerUpdateStatus,
  restartApp,
  relaunchApp,
  rollbackServer,
  startAppUpdate,
  subscribeAppUpdateState,
} from "@/lib/updater"

const backend = vi.hoisted(() => ({
  call: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock("@/lib/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transport")>()),
  getTransport: () => backend,
}))

let bridge: ElectronBridge

beforeEach(() => {
  vi.clearAllMocks()
  bridge = {
    platform: "darwin",
    version: "0.50.0",
    backendUrl: window.location.origin,
    token: "fresh-launch-token",
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => {}),
    revealItemInDir: vi.fn(async () => {}),
    openFileDialog: vi.fn(async () => ["/Users/me/project"]),
    saveFile: vi.fn(async () => "/Users/me/export.txt"),
    closeWindow: vi.fn(async () => {}),
    relaunchApp: vi.fn(async () => {}),
    minimizeWindow: vi.fn(async () => {}),
    toggleMaximizeWindow: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    notify: vi.fn(async () => true),
    openNotificationSettings: vi.fn(async () => {}),
  }
  Object.defineProperty(window, "maxcodeElectron", {
    configurable: true,
    value: bridge,
  })
  localStorage.setItem("codeg_token", "stale-browser-token")
})

afterEach(() => {
  Reflect.deleteProperty(window, "maxcodeElectron")
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe("MaxCode contract: Electron uses the managed local server", () => {
  it("offers native file actions through the Electron bridge", () => {
    expect(detectEnvironment()).toBe("electron")
    expect(isLocalDesktop()).toBe(true)
  })

  it("keeps Open-in-Finder available in the local desktop", () => {
    const menu = source("src/components/layout/open-in-menu.tsx")
    expect(menu).toContain("isLocalDesktop")
    expect(menu).toMatch(/explorerUnavailable = !isLocalDesktop\(\)/)
    expect(menu).not.toMatch(/explorerDisabled=\{!isDesktop/)

    const sidebar = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(sidebar).toContain("OpenInSubContent")
    expect(sidebar).not.toMatch(/\bisDesktop\s*\(/)
    expect(sidebar).not.toContain("explorerDisabled={!isDesktopMode}")
  })

  it("authenticates HTTP using the current launch token without persisting it", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ version: "0.50.0" }),
    }))
    vi.stubGlobal("fetch", fetch)
    const transport = new WebTransport(bridge.backendUrl)
    try {
      await transport.call("health")
      expect(fetch).toHaveBeenCalledWith(
        `${bridge.backendUrl}/api/health`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer fresh-launch-token",
          }),
        })
      )
      expect(getCodegToken()).toBe("fresh-launch-token")
      expect(localStorage.getItem("codeg_token")).toBe("stale-browser-token")
      const location = window.location.href
      redirectToCodegLogin()
      expect(window.location.href).toBe(location)
    } finally {
      transport.destroy()
    }
  })

  it("opens native paths, external URLs, directory dialogs and closes child windows", async () => {
    await openUrl("https://example.com/releases")
    await openPath("/Users/me/report.pdf")
    await revealItemInDir("/Users/me/report.pdf")
    await expect(openFileDialog({ directory: true })).resolves.toBe(
      "/Users/me/project"
    )
    await expect(
      openFileDialog({ directory: true, multiple: true })
    ).resolves.toEqual(["/Users/me/project"])
    await closeCurrentWindow()
    expect(bridge.openExternal).toHaveBeenCalledWith(
      "https://example.com/releases"
    )
    expect(bridge.openPath).toHaveBeenCalledWith("/Users/me/report.pdf")
    expect(bridge.revealItemInDir).toHaveBeenCalledWith("/Users/me/report.pdf")
    expect(bridge.closeWindow).toHaveBeenCalledOnce()
    expect(backend.call).not.toHaveBeenCalled()
  })

  it("authenticates WebSocket events with the launch token outside the URL", () => {
    const connect = vi.fn()
    class Socket {
      static OPEN = 1
      static CONNECTING = 0
      readyState = 0
      constructor(url: string, protocols: string[]) {
        connect(url, protocols)
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", Socket)
    const transport = new WebTransport(bridge.backendUrl)
    try {
      transport.eventStream()
      expect(connect).toHaveBeenCalledWith(
        `${bridge.backendUrl.replace(/^http/, "ws")}/ws/events`,
        ["codeg-events", `codeg-token.${btoa(bridge.token).replace(/=+$/, "")}`]
      )
    } finally {
      transport.destroy()
    }
  })

  it("never reveals browser workspace paths on the local machine", async () => {
    Reflect.deleteProperty(window, "maxcodeElectron")
    expect(isLocalDesktop()).toBe(false)
    await openPath("/remote/workspace")
    await revealItemInDir("/remote/workspace")
    expect(bridge.openPath).not.toHaveBeenCalled()
    expect(bridge.revealItemInDir).not.toHaveBeenCalled()
  })

  it("keeps notification permission honest and reports native delivery failure", async () => {
    expect(getNotificationPermission()).toBe("managed_by_os")
    await deliverSystemNotification("MaxCode", "Ready")
    expect(bridge.notify).toHaveBeenCalledWith("MaxCode", "Ready")
    vi.mocked(bridge.notify).mockResolvedValue(false)
    await expect(deliverSystemNotification("MaxCode", "Ready")).rejects.toThrow(
      "unavailable"
    )
    expect(backend.call).not.toHaveBeenCalled()
  })

  it("saves UTF-8 through the native dialog and preserves cancellation and write failures", async () => {
    const options = {
      content: "你好 Electron",
      suggestedName: "export.txt",
      mimeType: "text/plain",
      filterName: "Text",
      ext: "txt",
    }
    await expect(saveTextFile(options)).resolves.toBe("saved")
    const bytes = vi.mocked(bridge.saveFile).mock.calls[0][1]
    expect(new TextDecoder().decode(bytes)).toBe(options.content)
    vi.mocked(bridge.saveFile).mockResolvedValue(null)
    await expect(saveTextFile(options)).resolves.toBe("cancelled")
    vi.mocked(bridge.saveFile).mockRejectedValue(new Error("Disk full"))
    await expect(saveTextFile(options)).rejects.toThrow("Disk full")
  })
})

describe("MaxCode contract: Electron update ownership", () => {
  it("drives differential update lifecycle through the shell bridge without touching the server updater", async () => {
    const state = {
      seq: 8,
      status: "ready_to_restart" as const,
      version: "0.51.0",
    }
    const result = {
      currentVersion: "0.50.0",
      update: { version: "0.51.0", body: "Fixes" },
      selfUpdateSupported: true,
      liveProgress: true,
      runtime: "electron",
      rollbackAvailable: false,
    }
    const unlisten = vi.fn()
    bridge.checkForUpdate = vi.fn(async () => result)
    bridge.getUpdateStatus = vi.fn(async () => ({
      ...result,
      capability: "reexec" as const,
      restartDelayMs: 0,
    }))
    bridge.getUpdateState = vi.fn(async () => state)
    bridge.startUpdate = vi.fn(async () => state)
    bridge.installUpdate = vi.fn(async () => {})
    bridge.onUpdateState = vi.fn(() => unlisten)
    expect(await checkAppUpdateInfo()).toEqual(result)
    expect(await getAppUpdateState()).toEqual(state)
    expect(await getServerUpdateStatus()).toMatchObject({
      runtime: "electron",
      selfUpdateSupported: true,
    })
    expect(await startAppUpdate()).toEqual(state)
    const handler = vi.fn()
    const stop = await subscribeAppUpdateState(handler)
    expect(bridge.onUpdateState).toHaveBeenCalledWith(handler)
    stop()
    expect(unlisten).toHaveBeenCalledOnce()
    await restartApp()
    expect(bridge.installUpdate).toHaveBeenCalledOnce()
    await expect(rollbackServer()).rejects.toThrow()
    expect(backend.call).not.toHaveBeenCalled()
    expect(backend.subscribe).not.toHaveBeenCalled()
  })

  it("continues targeting the server updater in the browser", async () => {
    Reflect.deleteProperty(window, "maxcodeElectron")
    bridge.checkForUpdate = vi.fn()
    backend.call.mockResolvedValue({ currentVersion: "0.48.0", update: null })
    await checkAppUpdateInfo()
    expect(backend.call).toHaveBeenCalledWith("check_app_update")
    expect(bridge.checkForUpdate).not.toHaveBeenCalled()
  })
  it("relaunches the owning shell to apply staged backup data", async () => {
    await relaunchApp()
    expect(bridge.relaunchApp).toHaveBeenCalledOnce()
    expect(backend.call).not.toHaveBeenCalled()
  })

  it("offers release information without advertising server binary replacement", async () => {
    backend.call.mockResolvedValue({
      currentVersion: "0.49.0",
      update: { version: "0.51.0", body: "Release notes" },
      selfUpdateSupported: true,
      liveProgress: true,
      rollbackAvailable: true,
      runtime: "binary",
    })
    await expect(checkAppUpdateInfo()).resolves.toEqual({
      currentVersion: "0.50.0",
      update: { version: "0.51.0", body: "Release notes" },
      selfUpdateSupported: false,
      liveProgress: false,
      rollbackAvailable: false,
      runtime: "electron",
    })
    await expect(getCurrentAppVersion()).resolves.toBe("0.50.0")
    await expect(getServerUpdateStatus()).resolves.toBeNull()
  })

  it("cannot install, restart or roll back the bundled server through updater APIs", async () => {
    await expect(getAppUpdateState()).resolves.toEqual({
      seq: 0,
      status: "idle",
    })
    const unlisten = await subscribeAppUpdateState(vi.fn())
    unlisten()
    for (const action of [startAppUpdate, restartApp, rollbackServer]) {
      await expect(action()).rejects.toThrow("Electron desktop release")
    }
    expect(backend.call).not.toHaveBeenCalled()
    expect(backend.subscribe).not.toHaveBeenCalled()
  })
})
