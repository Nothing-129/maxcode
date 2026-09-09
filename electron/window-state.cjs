/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs")
const path = require("node:path")

function createWindowState(file, screen) {
  let state = {}
  let timer = null
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"))
    if (
      ["x", "y", "width", "height"].every((key) =>
        Number.isSafeInteger(saved?.bounds?.[key])
      ) &&
      saved.bounds.width >= 900 &&
      saved.bounds.height >= 600
    ) {
      state = {
        bounds: saved.bounds,
        maximized: saved.maximized === true,
        fullScreen: saved.fullScreen === true,
      }
    }
  } catch {
    // First launch or a damaged state file uses the default window size.
  }

  function options() {
    if (!state.bounds) return {}
    const area = screen.getDisplayMatching(state.bounds).workArea
    const width = Math.max(900, Math.min(state.bounds.width, area.width))
    const height = Math.max(600, Math.min(state.bounds.height, area.height))
    return {
      width,
      height,
      x: Math.max(
        area.x,
        Math.min(state.bounds.x, area.x + area.width - width)
      ),
      y: Math.max(
        area.y,
        Math.min(state.bounds.y, area.y + area.height - height)
      ),
    }
  }

  function capture(window) {
    if (!window || window.isDestroyed() || window.isMinimized()) return
    state = {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    }
  }

  function save(window) {
    clearTimeout(timer)
    capture(window)
    if (!state.bounds) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 })
      fs.renameSync(`${file}.tmp`, file)
    } catch (error) {
      console.warn("Could not save window state:", error.message)
    }
  }

  function track(window) {
    window.once("ready-to-show", () => {
      const { maximized, fullScreen } = state
      if (maximized) window.maximize()
      if (fullScreen) window.setFullScreen(true)
      capture(window)
    })
    for (const event of [
      "resize",
      "move",
      "maximize",
      "unmaximize",
      "enter-full-screen",
      "leave-full-screen",
    ]) {
      window.on(event, () => {
        capture(window)
        clearTimeout(timer)
        timer = setTimeout(() => save(window), 200)
      })
    }
    // Flush the last visible state; minimized windows must not overwrite it.
    window.on("minimize", () => save(window))
    window.on("close", () => save(window))
    window.once("closed", () => clearTimeout(timer))
  }

  return { options, save, track }
}

module.exports = { createWindowState }
