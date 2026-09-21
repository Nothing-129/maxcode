/* eslint-disable @typescript-eslint/no-require-imports */
const http = require("node:http")
const https = require("node:https")
const {
  SOURCE_PROBE_TIMEOUT_MS,
  orderUpdateSources,
  sourceProbeUrls,
  updateSources,
} = require("./update-config.cjs")

function probeUrl(url, timeoutMs = SOURCE_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const pending = new Set()
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const req of pending) req.destroy()
      pending.clear()
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    const visit = (target, hops) => {
      if (settled) return
      if (hops > 5) return finish(null)
      let parsed
      try {
        parsed = new URL(target)
      } catch {
        return finish(null)
      }
      const lib = parsed.protocol === "http:" ? http : https
      const req = lib.get(
        parsed,
        {
          timeout: timeoutMs,
          headers: { "User-Agent": "MaxCode-Updater" },
        },
        (res) => {
          pending.delete(req)
          if (settled) {
            res.resume()
            return
          }
          const loc = res.headers.location
          if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
            res.resume()
            visit(new URL(loc, parsed).href, hops + 1)
            return
          }
          res.resume()
          if (res.statusCode >= 200 && res.statusCode < 300)
            finish(Date.now() - started)
          else finish(null)
        }
      )
      pending.add(req)
      req.on("timeout", () => finish(null))
      req.on("error", () => {
        pending.delete(req)
        if (!settled && pending.size === 0) finish(null)
      })
    }
    visit(url, 0)
  })
}

// One owner for every window. No renderer-supplied feed, version or file path.
function createDesktopUpdater({
  updater,
  version,
  enabled,
  emit,
  beforeInstall,
  onInstallError,
  arch = process.arch,
  platform = process.platform,
  probe = probeUrl,
}) {
  let state = { seq: 0, status: "idle" }
  let available = null
  let checking = null
  let downloading = null
  let restarting = false
  const snapshot = () => ({ ...state })
  const transition = (next) => {
    state = { ...next, seq: state.seq + 1 }
    emit(snapshot())
  }
  const errorText = (error) => String(error?.message || error)
  const failure = (error) =>
    transition({
      status: "error",
      version: state.version,
      error: errorText(error),
    })
  const info = () => ({
    currentVersion: version,
    update: available,
    selfUpdateSupported: enabled,
    liveProgress: enabled,
    rollbackAvailable: false,
    runtime: "electron",
  })
  const sources = updateSources(arch, version)
  let ranked = null
  let rankedAt = 0
  const applySource = (source) => {
    updater.setFeedURL(source.feed)
    updater.previousBlockmapBaseUrlOverride = source.blockmap
  }
  const sourcesForAttempt = async () => {
    if (ranked && Date.now() - rankedAt < 60_000) return ranked
    const urls = sourceProbeUrls(arch, platform)
    const [github, mirror] = await Promise.all([
      probe(urls.github, SOURCE_PROBE_TIMEOUT_MS),
      probe(urls.mirror, SOURCE_PROBE_TIMEOUT_MS),
    ])
    ranked = orderUpdateSources(sources, { github, mirror })
    rankedAt = Date.now()
    return ranked
  }
  const trySources = async (operation) => {
    let lastError
    for (const source of await sourcesForAttempt()) {
      applySource(source)
      try {
        return await operation()
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.disableDifferentialDownload = false
  applySource(sources[0])
  updater.on("error", (error) => {
    if (restarting) {
      failure(error)
      onInstallError?.(error)
    }
  })
  updater.on("update-available", (update) => {
    available = {
      version: update.version,
      body:
        typeof update.releaseNotes === "string"
          ? update.releaseNotes
          : (update.releaseNotes || [])
              .map((entry) => entry.note || "")
              .join("\n\n"),
      date: update.releaseDate || null,
    }
  })
  updater.on("update-not-available", () => {
    available = null
  })
  updater.on("download-progress", (progress) => {
    if (state.status !== "downloading") return
    transition({
      ...state,
      downloaded: progress.transferred,
      total: progress.total,
    })
  })
  updater.on("update-downloaded", (update) => {
    transition({ status: "ready_to_restart", version: update.version })
  })

  function checkRaw() {
    if (!checking) {
      checking = trySources(() => updater.checkForUpdates()).finally(() => {
        checking = null
      })
    }
    return checking
  }
  const controller = {
    snapshot,
    status: () => ({ ...info(), capability: "reexec", restartDelayMs: 0 }),
    async check() {
      if (
        enabled &&
        !downloading &&
        !["ready_to_restart", "restarting"].includes(state.status)
      ) {
        await checkRaw()
        // Downloads are owned by the main process, never by a mounted view.
        // start() coalesces simultaneous checks from multiple windows.
        if (available) controller.start()
      }
      return info()
    },
    start() {
      if (!enabled)
        throw new Error(
          "Automatic updates require an installed desktop package"
        )
      if (
        downloading ||
        ["ready_to_restart", "restarting"].includes(state.status)
      )
        return snapshot()
      transition({
        status: "downloading",
        downloaded: 0,
        total: null,
        version: available?.version,
      })
      downloading = Promise.resolve()
        .then(async () => {
          if (checking) {
            try {
              await checking
            } catch {
              // Check already failed; the download loop retries every source.
            }
          }
          let lastError
          for (const source of await sourcesForAttempt()) {
            applySource(source)
            try {
              await updater.checkForUpdates()
              if (!available) {
                transition({ status: "idle" })
                return
              }
              transition({ ...state, version: available.version })
              await updater.downloadUpdate()
              return
            } catch (error) {
              lastError = error
            }
          }
          throw lastError
        })
        .catch(failure)
        .finally(() => {
          downloading = null
        })
      return snapshot()
    },
    async restart() {
      if (restarting) return
      if (!enabled || state.status !== "ready_to_restart")
        throw new Error("No verified desktop update is ready to install")
      restarting = true
      transition({ status: "restarting", version: state.version })
      try {
        await beforeInstall()
        // Reply to IPC before the updater closes the window.
        setImmediate(() => {
          try {
            updater.quitAndInstall(false, true)
          } catch (error) {
            failure(error)
            onInstallError?.(error)
          }
        })
      } catch (error) {
        restarting = false
        failure(error)
        throw error
      }
    },
  }
  return controller
}

module.exports = { createDesktopUpdater, probeUrl }
