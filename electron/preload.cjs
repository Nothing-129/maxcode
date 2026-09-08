/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron")

// Obtain credentials over a checked IPC channel: never put them in a URL,
// command-line argument, cookie, or renderer localStorage.
const bootstrap = ipcRenderer.sendSync("maxcode:bootstrap")
if (bootstrap) {
  const { storage, restoreStorage, ...config } = bootstrap
  // Chromium localStorage is keyed by origin, including the backend's ephemeral
  // port. Restore before the app's first script reads preferences and mirror
  // later writes to the main process's private profile directory.
  try {
    if (restoreStorage) {
      localStorage.clear()
      for (const [key, value] of Object.entries(storage)) {
        localStorage.setItem(key, value)
      }
    }
    localStorage.removeItem("codeg_token")
  } catch {
    // A full or unavailable browser store must not prevent desktop startup.
  }
  let lastSnapshot = JSON.stringify(storage)
  const savePreferences = (synchronous = false) => {
    try {
      const snapshot = {}
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)
        const value = localStorage.getItem(key)
        if (key !== "codeg_token" && !value?.includes(config.token)) {
          Object.defineProperty(snapshot, key, {
            value,
            enumerable: true,
          })
        }
      }
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSnapshot) return
      if (synchronous) {
        ipcRenderer.sendSync("maxcode:save-preferences-sync", snapshot)
      } else {
        ipcRenderer.send("maxcode:save-preferences", snapshot)
      }
      lastSnapshot = serialized
    } catch {
      // Preferences are best effort; main validates size and credential exclusion.
    }
  }
  setInterval(savePreferences, 1000)
  window.addEventListener("pagehide", () => savePreferences(true))

  contextBridge.exposeInMainWorld("maxcodeElectron", {
    ...config,
    openExternal: (url) => ipcRenderer.invoke("maxcode:open-external", url),
    openPath: (filePath) => ipcRenderer.invoke("maxcode:open-path", filePath),
    revealItemInDir: (filePath) =>
      ipcRenderer.invoke("maxcode:reveal-item", filePath),
    openFileDialog: (options) =>
      ipcRenderer.invoke("maxcode:open-file-dialog", options),
    saveFile: (options, bytes) =>
      ipcRenderer.invoke("maxcode:save-file", options, bytes),
    closeWindow: () => ipcRenderer.invoke("maxcode:close-window"),
    relaunchApp: () => ipcRenderer.invoke("maxcode:relaunch-app"),
    minimizeWindow: () => ipcRenderer.invoke("maxcode:minimize-window"),
    toggleMaximizeWindow: () => ipcRenderer.invoke("maxcode:toggle-maximize"),
    isMaximized: () => ipcRenderer.invoke("maxcode:is-maximized"),
    notify: (title, body) => ipcRenderer.invoke("maxcode:notify", title, body),
    openNotificationSettings: () =>
      ipcRenderer.invoke("maxcode:notification-settings"),
  })
}
