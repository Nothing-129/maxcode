/* eslint-disable @typescript-eslint/no-require-imports */
const { UPDATE_REPOSITORY, updateFeed } = require("./update-config.cjs")

// One owner for every window. No renderer-supplied feed, version or file path.
function createDesktopUpdater({
  updater,
  version,
  enabled,
  emit,
  beforeInstall,
  onInstallError,
  arch = process.arch,
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

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.disableDifferentialDownload = false
  updater.setFeedURL(updateFeed(arch))
  // GitHub's latest release cannot serve the previous version's blockmap.
  updater.previousBlockmapBaseUrlOverride = `${UPDATE_REPOSITORY}/releases/download/v${version}/`
  updater.on("error", (error) => {
    if (downloading || restarting) failure(error)
    if (restarting) onInstallError?.(error)
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
      checking = Promise.resolve()
        .then(() => updater.checkForUpdates())
        .finally(() => {
          checking = null
        })
    }
    return checking
  }
  return {
    snapshot,
    status: () => ({ ...info(), capability: "reexec", restartDelayMs: 0 }),
    async check() {
      if (
        enabled &&
        !downloading &&
        !["ready_to_restart", "restarting"].includes(state.status)
      )
        await checkRaw()
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
          await checkRaw()
          if (!available) {
            transition({ status: "idle" })
            return
          }
          transition({ ...state, version: available.version })
          await updater.downloadUpdate()
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
}

module.exports = { createDesktopUpdater }
