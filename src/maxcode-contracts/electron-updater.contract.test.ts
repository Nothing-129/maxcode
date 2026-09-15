// @vitest-environment node
import { execFileSync } from "node:child_process"
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const { createDesktopUpdater } = require("../../electron/updater.cjs")
const {
  GITHUB_SLOW_MS,
  UPDATE_MIRROR,
  orderUpdateSources,
  sourceProbeUrls,
  updateSources,
  updateManifestName,
} = require("../../electron/update-config.cjs")

const githubFeed = {
  provider: "github",
  owner: "Nothing-129",
  repo: "maxcode",
  channel: "latest-arm64",
}
const mirrorFeed = {
  provider: "generic",
  url: UPDATE_MIRROR,
  channel: "latest-arm64",
}

function fixture(
  enabled = true,
  probe: (url: string) => Promise<number | null> = async () => 50
) {
  let finish!: () => void
  let fail!: (error: Error) => void
  const events: Array<{ seq: number; status: string }> = []
  const order: string[] = []
  const updater = Object.assign(new EventEmitter(), {
    previousBlockmapBaseUrlOverride: null as string | null,
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
    platform: "darwin",
    probe,
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
    expect(updater.setFeedURL).toHaveBeenCalledWith(githubFeed)
    expect(updater.previousBlockmapBaseUrlOverride).toBe(
      "https://github.com/Nothing-129/maxcode/releases/download/v0.30.6/"
    )
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
      expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(2)
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
      expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(3)
    )
    f.updater.emit("update-downloaded", { version: "0.30.7" })
    f.finish()
  })

  it("falls back to the Cloudflare Tunnel generic mirror when GitHub is unreachable", async () => {
    const { controller, updater } = fixture()
    updater.checkForUpdates
      .mockRejectedValueOnce(new Error("github down"))
      .mockImplementationOnce(async () => {
        updater.emit("update-available", {
          version: "0.30.7",
          releaseNotes: "Fixes",
        })
      })
    expect(await controller.check()).toMatchObject({
      update: { version: "0.30.7" },
    })
    expect(updater.setFeedURL.mock.calls.map((call) => call[0])).toEqual([
      githubFeed,
      githubFeed,
      mirrorFeed,
    ])
    expect(updater.previousBlockmapBaseUrlOverride).toBe(
      `${UPDATE_MIRROR}/download/v0.30.6/`
    )
  })

  it("uses the Cloudflare Tunnel mirror first when GitHub is slower than the probe threshold", async () => {
    const { controller, updater } = fixture(true, async (url) =>
      url.includes("github.com") ? GITHUB_SLOW_MS + 400 : 90
    )
    expect(await controller.check()).toMatchObject({
      update: { version: "0.30.7" },
    })
    expect(updater.setFeedURL.mock.calls.map((call) => call[0])).toEqual([
      githubFeed,
      mirrorFeed,
    ])
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it("retries the download on the Cloudflare Tunnel mirror after GitHub transfer fails", async () => {
    const f = fixture()
    f.controller.start()
    await vi.waitFor(() =>
      expect(f.updater.downloadUpdate).toHaveBeenCalledOnce()
    )
    f.fail()
    await vi.waitFor(() =>
      expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(2)
    )
    expect(f.updater.setFeedURL).toHaveBeenLastCalledWith(mirrorFeed)
    f.updater.emit("update-downloaded", { version: "0.30.7" })
    f.finish()
    await vi.waitFor(() =>
      expect(f.controller.snapshot().status).toBe("ready_to_restart")
    )
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

describe("MaxCode contract: Electron Cloudflare Tunnel update mirror", () => {
  it("keeps GitHub as the primary feed and publishes only there", () => {
    expect(updateSources("arm64", "0.30.6")).toEqual([
      {
        feed: githubFeed,
        blockmap:
          "https://github.com/Nothing-129/maxcode/releases/download/v0.30.6/",
      },
      {
        feed: mirrorFeed,
        blockmap: `${UPDATE_MIRROR}/download/v0.30.6/`,
      },
    ])
    expect(UPDATE_MIRROR).toBe("https://maxcode-update.aifalao.net")
    expect(sourceProbeUrls("arm64", "darwin")).toEqual({
      github:
        "https://github.com/Nothing-129/maxcode/releases/latest/download/latest-arm64-mac.yml",
      mirror: "https://maxcode-update.aifalao.net/latest-arm64-mac.yml",
    })
    const sources = updateSources("arm64", "0.30.6")
    expect(
      orderUpdateSources(sources, { github: 1200, mirror: 180 }).map(
        (source: { feed: { provider: string } }) => source.feed.provider
      )
    ).toEqual(["generic", "github"])
    expect(
      orderUpdateSources(sources, { github: 120, mirror: 80 }).map(
        (source: { feed: { provider: string } }) => source.feed.provider
      )
    ).toEqual(["github", "generic"])
    expect(
      orderUpdateSources(sources, { github: null, mirror: 90 }).map(
        (source: { feed: { provider: string } }) => source.feed.provider
      )
    ).toEqual(["generic", "github"])
  })

  it.each(["arm64", "x64"])(
    "resolves %s manifests and previous blockmaps through public HTTPS",
    (arch) => {
      const mirror = updateSources(arch, "0.30.15")[1]
      expect(
        new URL(updateManifestName("mac", arch), `${mirror.feed.url}/`).href
      ).toBe(`https://maxcode-update.aifalao.net/latest-${arch}-mac.yml`)
      expect(
        new URL(
          `MaxCode-Electron-0.30.15-mac-${arch}.zip.blockmap`,
          mirror.blockmap
        ).href
      ).toBe(
        `https://maxcode-update.aifalao.net/download/v0.30.15/MaxCode-Electron-0.30.15-mac-${arch}.zip.blockmap`
      )
    }
  )

  it("maps mirror paths to MaxCode GitHub assets and rejects anything else", () => {
    const script = resolve("electron/scripts/update-mirror.py")
    const mapped = (path: string) =>
      execFileSync("python3", [script, "--resolve", path], {
        encoding: "utf8",
      }).trim()
    expect(mapped("/latest-arm64-mac.yml")).toBe(
      "https://github.com/Nothing-129/maxcode/releases/latest/download/latest-arm64-mac.yml"
    )
    expect(
      mapped("/download/v0.30.15/MaxCode-Electron-0.30.15-mac-arm64.zip.blockmap")
    ).toBe(
      "https://github.com/Nothing-129/maxcode/releases/download/v0.30.15/MaxCode-Electron-0.30.15-mac-arm64.zip.blockmap"
    )
    expect(mapped("/health")).toBe("")
    expect(mapped("/etc/passwd")).toBe("")
    expect(mapped("/download/v0.30.15/../latest-arm64-mac.yml")).toBe("")
  })
})
