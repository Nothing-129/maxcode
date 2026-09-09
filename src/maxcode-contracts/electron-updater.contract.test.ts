// @vitest-environment node
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const { createDesktopUpdater } = require("../../electron/updater.cjs")

function fixture(enabled = true) {
  let finish!: () => void
  let fail!: (error: Error) => void
  const events: Array<{ seq: number; status: string }> = []
  const order: string[] = []
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => {
      updater.emit("update-available", {
        version: "0.30.7",
        releaseNotes: "Fixes",
      })
    }),
    downloadUpdate: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = resolve
          fail = reject
        })
    ),
    quitAndInstall: vi.fn(() => order.push("install")),
  })
  const beforeInstall = vi.fn(async () => {
    order.push("stop backend")
  })
  const controller = createDesktopUpdater({
    updater,
    version: "0.30.6",
    arch: "arm64",
    enabled,
    emit: (state: { seq: number; status: string }) => events.push(state),
    beforeInstall,
    onInstallError: vi.fn(),
  })
  return {
    controller,
    updater,
    events,
    beforeInstall,
    order,
    finish: () => finish(),
    fail: () => fail(new Error("Network unavailable")),
  }
}

describe("MaxCode contract: Electron differential update lifecycle", () => {
  it("uses the personal architecture feed and opts into differential downloads without downloading or installing on its own", async () => {
    const { controller, updater } = fixture()
    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      disableDifferentialDownload: false,
      allowDowngrade: false,
      allowPrerelease: false,
    })
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: "github",
      owner: "Nothing-129",
      repo: "maxcode",
      channel: "latest-arm64",
    })
    expect(await controller.check()).toMatchObject({
      selfUpdateSupported: true,
      runtime: "electron",
      update: { version: "0.30.7" },
    })
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it("coalesces window actions and keeps progress snapshots through the user-requested restart", async () => {
    const f = fixture()
    expect(f.controller.start().status).toBe("downloading")
    f.controller.start()
    await vi.waitFor(() =>
      expect(f.updater.downloadUpdate).toHaveBeenCalledOnce()
    )
    f.updater.emit("download-progress", { transferred: 2048, total: 4096 })
    expect(f.controller.snapshot()).toMatchObject({
      status: "downloading",
      downloaded: 2048,
      total: 4096,
    })
    f.updater.emit("update-downloaded", { version: "0.30.7" })
    f.finish()
    const snapshot = f.controller.snapshot()
    snapshot.status = "idle"
    expect(f.controller.snapshot().status).toBe("ready_to_restart")
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    await f.controller.check()
    expect(f.updater.checkForUpdates).toHaveBeenCalledOnce()
    await Promise.all([f.controller.restart(), f.controller.restart()])
    await vi.waitFor(() =>
      expect(f.updater.quitAndInstall).toHaveBeenCalledOnce()
    )
    expect(f.order).toEqual(["stop backend", "install"])
    expect(f.events.map((state) => state.seq)).toEqual(
      [...f.events.keys()].map((index) => index + 1)
    )
  })

  it("exposes download errors and permits a fresh retry", async () => {
    const f = fixture()
    f.controller.start()
    await vi.waitFor(() =>
      expect(f.updater.downloadUpdate).toHaveBeenCalledOnce()
    )
    f.fail()
    await vi.waitFor(() =>
      expect(f.controller.snapshot()).toMatchObject({
        status: "error",
        error: "Network unavailable",
      })
    )
    f.controller.start()
    await vi.waitFor(() =>
      expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(2)
    )
    f.updater.emit("update-downloaded", { version: "0.30.7" })
    f.finish()
  })

  it("cannot install without a verified download, or from a disabled development / smoke package", async () => {
    const f = fixture(false)
    expect(await f.controller.check()).toMatchObject({
      update: null,
      selfUpdateSupported: false,
    })
    expect(() => f.controller.start()).toThrow("installed desktop package")
    await expect(f.controller.restart()).rejects.toThrow(
      "No verified desktop update"
    )
    expect(f.updater.checkForUpdates).not.toHaveBeenCalled()
    const installed = fixture()
    await expect(installed.controller.restart()).rejects.toThrow(
      "No verified desktop update"
    )
    expect(installed.beforeInstall).not.toHaveBeenCalled()
  })
})
