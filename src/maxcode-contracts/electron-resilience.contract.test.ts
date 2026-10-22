// @vitest-environment node
import { EventEmitter } from "node:events"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const {
  createDesktopLog,
  installRendererRecovery,
} = require("../../electron/resilience.cjs")
const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true })
})
function logFile() {
  const dir = mkdtempSync(join(tmpdir(), "maxcode-resilience-"))
  directories.push(dir)
  return join(dir, "desktop.log")
}
function fixture() {
  let quitting = false
  let destroyed = false
  let time = 0
  const window = {
    id: 7,
    isDestroyed: () => destroyed,
    close: vi.fn(),
    webContents: Object.assign(new EventEmitter(), { reload: vi.fn() }),
  }
  const log = vi.fn()
  const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) }
  installRendererRecovery(window, {
    log,
    dialog,
    isQuitting: () => quitting,
    now: () => time,
  })
  const crash = () =>
    window.webContents.emit(
      "render-process-gone",
      {},
      {
        reason: "crashed",
        exitCode: 139,
      }
    )
  return {
    window,
    log,
    dialog,
    crash,
    quit: () => {
      quitting = true
    },
    destroy: () => {
      destroyed = true
    },
    advance: () => {
      time += 60_000
    },
  }
}

describe("MaxCode contract: desktop crash isolation and durable diagnostics", () => {
  it("reloads only the failed window and preserves other windows", () => {
    const failed = fixture()
    const other = fixture()
    failed.crash()
    expect(failed.window.webContents.reload).toHaveBeenCalledOnce()
    expect(other.window.webContents.reload).not.toHaveBeenCalled()
    expect(failed.dialog.showMessageBox).not.toHaveBeenCalled()
    expect(failed.log).toHaveBeenCalledWith("renderer-gone", {
      windowId: 7,
      reason: "crashed",
      exitCode: 139,
      quitting: false,
    })
    failed.advance()
    failed.crash()
    expect(failed.window.webContents.reload).toHaveBeenCalledTimes(2)
  })

  it("bounds automatic retries and lets the user close only the failed window", async () => {
    const f = fixture()
    f.dialog.showMessageBox.mockResolvedValue({ response: 1 })
    f.crash()
    f.crash()
    f.crash() // Do not open overlapping crash dialogs.
    await Promise.resolve()
    expect(f.dialog.showMessageBox).toHaveBeenCalledOnce()
    expect(f.window.webContents.reload).toHaveBeenCalledOnce()
    expect(f.window.close).toHaveBeenCalledOnce()
  })

  it("supports explicit reload after repeated failures", async () => {
    const f = fixture()
    f.crash()
    f.crash()
    await Promise.resolve()
    expect(f.window.webContents.reload).toHaveBeenCalledTimes(2)
  })

  it("never reloads during shutdown or after a window has been destroyed", async () => {
    const f = fixture()
    f.crash()
    f.crash()
    f.quit()
    await Promise.resolve()
    f.crash()
    expect(f.window.webContents.reload).toHaveBeenCalledOnce()
    const closed = fixture()
    closed.destroy()
    closed.crash()
    expect(closed.window.webContents.reload).not.toHaveBeenCalled()
  })

  it("logs recovery failures without escalating to application shutdown", async () => {
    const f = fixture()
    f.window.webContents.reload.mockImplementation(() => {
      throw new Error("gone")
    })
    f.crash()
    f.dialog.showMessageBox.mockRejectedValue(new Error("dialog unavailable"))
    f.crash()
    await Promise.resolve()
    expect(
      f.log.mock.calls.filter(([event]) => event === "renderer-recovery-failed")
    ).toHaveLength(2)
  })

  it("persists redacted diagnostics, rotates bounded logs and tolerates IO failure", () => {
    const file = logFile()
    const log = createDesktopLog(file, {
      token: () => "private-token",
      version: "test",
    })
    log("fatal-error", { message: "backend private-token stopped" })
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      event: "fatal-error",
      version: "test",
      message: "backend [redacted] stopped",
    })
    if (process.platform !== "win32")
      expect(statSync(file).mode & 0o777).toBe(0o600)
    writeFileSync(file, "x".repeat(2 * 1024 * 1024 + 1))
    log("process-exit", { code: 0 })
    expect(statSync(`${file}.1`).size).toBeGreaterThan(2 * 1024 * 1024)
    const exitRecord = JSON.parse(readFileSync(file, "utf8"))
    expect(exitRecord.event).toBe("process-exit")
    expect(() =>
      createDesktopLog(join(file, "impossible"))("exit")
    ).not.toThrow()
  })

  it("wires recovery, fatal errors and process lifecycle logging into the desktop", () => {
    const main = readFileSync(join(process.cwd(), "electron/main.cjs"), "utf8")
    expect(main).toContain("installRendererRecovery(window,")
    expect(main).not.toContain("Renderer stopped:")
    for (const event of [
      "fatal-error",
      "backend-unexpected-exit",
      "before-quit",
      "process-exit",
      "uncaught-exception",
      "child-process-gone",
      "window-load-failed",
    ]) {
      expect(main).toContain(`\"${event}\"`)
    }
  })
})
