// @vitest-environment node
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const { createWindowState } = require("../../electron/window-state.cjs")
const directories: string[] = []
const screen = {
  getDisplayMatching: () => ({
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  }),
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "maxcode-window-"))
  directories.push(dir)
  const file = join(dir, "window-state.json")
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isMinimized: vi.fn(() => false),
    getNormalBounds: () => ({ x: 100, y: 50, width: 1200, height: 800 }),
    isMaximized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    maximize: vi.fn(),
    setFullScreen: vi.fn(),
  })
  const state = createWindowState(file, screen)
  state.track(window)
  return { file, window, state }
}
afterEach(() => {
  vi.useRealTimers()
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true })
})

describe("MaxCode contract: persist Electron workspace window across updates", () => {
  it("flushes pending resize synchronously before restart and restores normal bounds", () => {
    vi.useFakeTimers()
    const { file, window, state } = fixture()
    window.emit("resize")
    state.save(window)
    expect(createWindowState(file, screen).options()).toEqual(
      window.getNormalBounds()
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it("preserves maximized and full-screen state with normal bounds when minimized or closed", () => {
    const { file, window, state } = fixture()
    window.isMaximized.mockReturnValue(true)
    window.isFullScreen.mockReturnValue(true)
    window.emit("resize")
    window.isMinimized.mockReturnValue(true)
    window.emit("minimize")
    window.isMaximized.mockReturnValue(false)
    state.save(window)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      bounds: window.getNormalBounds(),
      maximized: true,
      fullScreen: true,
    })
    const restored = createWindowState(file, screen)
    restored.track(window)
    window.emit("ready-to-show")
    expect(window.maximize).toHaveBeenCalled()
    expect(window.setFullScreen).toHaveBeenCalledWith(true)
    window.emit("close")
    window.emit("closed")
  })

  it("saves on ordinary close and reopens with the same size", () => {
    const { file, window } = fixture()
    window.emit("close")
    window.emit("closed")
    expect(createWindowState(file, screen).options()).toEqual(
      window.getNormalBounds()
    )
  })

  it("falls back for invalid files and brings disconnected-display bounds on screen", () => {
    const { file, state } = fixture()
    expect(state.options()).toEqual({})
    for (const contents of ["broken", "null", '{"bounds":{"width":-1}}']) {
      writeFileSync(file, contents)
      expect(createWindowState(file, screen).options()).toEqual({})
    }
    writeFileSync(
      file,
      JSON.stringify({
        bounds: { x: -3000, y: 2000, width: 2500, height: 1600 },
      })
    )
    expect(createWindowState(file, screen).options()).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })

  it("wires persistence only to the workspace and flushes before updater shutdown", () => {
    const main = readFileSync(join(process.cwd(), "electron/main.cjs"), "utf8")
    expect(main).toContain("...windowState.options()")
    expect(main).toContain("windowState.track(window)")
    expect(main).toContain("beforeInstall: shutdown")
    const shutdown = main.slice(main.indexOf("async function shutdown()"))
    expect(shutdown.indexOf("windowState.save(mainWindow)")).toBeLessThan(
      shutdown.indexOf("startupAbort.abort()")
    )
    expect(main.match(/windowState.track\(/g)).toHaveLength(1)
  })
})
