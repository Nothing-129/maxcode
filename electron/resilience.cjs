/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs")
const path = require("node:path")

// Synchronous, bounded and best-effort: exit handlers cannot await filesystem IO.
function createDesktopLog(file, { token = () => "", version = "" } = {}) {
  return (event, details = {}) => {
    try {
      let line = JSON.stringify({
        timestamp: new Date().toISOString(),
        version,
        pid: process.pid,
        event,
        ...details,
      })
      const secret = token()
      if (secret) line = line.replaceAll(secret, "[redacted]")
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
        fs.renameSync(file, `${file}.1`)
      }
      fs.appendFileSync(file, `${line}\n`, { mode: 0o600 })
    } catch {
      // A full disk or inaccessible log directory must not crash the desktop.
    }
  }
}

function installRendererRecovery(
  window,
  { log, isQuitting, dialog, now = Date.now }
) {
  let lastRecovery = -Infinity
  let prompting = false
  const alive = () => !isQuitting() && !window.isDestroyed()
  window.webContents.on("render-process-gone", async (_event, details) => {
    log("renderer-gone", {
      windowId: window.id,
      reason: details.reason,
      exitCode: details.exitCode,
      quitting: isQuitting(),
    })
    if (!alive() || prompting) return
    const reload = () => {
      if (!alive()) return
      lastRecovery = now()
      log("renderer-reload", { windowId: window.id })
      window.webContents.reload()
    }
    try {
      // Recover once without disturbing other windows or backend agent sessions.
      // A crash loop requires an explicit choice instead of unbounded reloads.
      if (now() - lastRecovery >= 60_000) {
        reload()
        return
      }
      prompting = true
      const { response } = await dialog.showMessageBox(window, {
        type: "error",
        title: "MaxCode window stopped",
        message: "This window stopped unexpectedly again.",
        detail:
          "Other windows and background sessions are still running. Reload this window or close it. Diagnostics are saved in desktop.log.",
        buttons: ["Reload window", "Close window"],
        defaultId: 0,
        cancelId: 1,
      })
      if (!alive()) return
      if (response === 0) reload()
      else window.close()
    } catch (error) {
      log("renderer-recovery-failed", {
        windowId: window.id,
        message: String(error?.message || error),
      })
    } finally {
      prompting = false
    }
  })
}

module.exports = { createDesktopLog, installRendererRecovery }
