/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  screen,
  session,
  shell,
} = require("electron")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { createWindowState } = require("./window-state.cjs")
const {
  dialogOptions,
  externalUrl,
  isTrustedAppUrl,
  isTrustedUrl,
  legacyDataDir,
  localPath,
  sanitizeStorage,
  startBackend,
} = require("./runtime.cjs")

app.setName("MaxCode")
app.setAppUserModelId("app.codeg.electron")
app.enableSandbox()

const smokeTest = process.argv.includes("--smoke-test")
const smokeDir = smokeTest
  ? process.env.CODEG_ELECTRON_SMOKE_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), "maxcode-electron-smoke-"))
  : null
if (smokeDir) {
  app.setPath("userData", path.join(smokeDir, "profile"))
}

let mainWindow = null
let backend = null
let backendStartup = null
const startupAbort = new AbortController()
const windows = new Set()
let restoredStorage = false
let starting = true
let quitting = false
let shutdownPromise = null
let desktopUpdater = null
let preferences = {}
const notifications = new Set()
const preferencesFile = path.join(
  app.getPath("userData"),
  "renderer-preferences.json"
)
const windowState = createWindowState(
  path.join(app.getPath("userData"), "window-state.json"),
  screen
)

function trustedSender(event) {
  return Boolean(
    backend &&
    windows.has(BrowserWindow.fromWebContents(event.sender)) &&
    event.senderFrame === event.sender.mainFrame &&
    isTrustedAppUrl(event.senderFrame.url, backend.backendUrl)
  )
}

function writePreferences(value) {
  preferences = sanitizeStorage(value, backend.token)
  fs.mkdirSync(path.dirname(preferencesFile), { recursive: true })
  const temporary = `${preferencesFile}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(preferences), { mode: 0o600 })
  fs.renameSync(temporary, preferencesFile)
}

function installBridge() {
  ipcMain.on("maxcode:bootstrap", (event) => {
    const trusted = trustedSender(event)
    event.returnValue = trusted
      ? {
          platform: process.platform,
          version: app.getVersion(),
          backendUrl: backend.backendUrl,
          token: backend.token,
          storage: preferences,
          restoreStorage: !restoredStorage,
        }
      : null
    if (trusted) restoredStorage = true
  })
  const save = (event, value, synchronous) => {
    try {
      if (!trustedSender(event)) throw new Error("Untrusted preference sender")
      writePreferences(value)
      if (synchronous) event.returnValue = true
    } catch {
      if (synchronous) event.returnValue = false
    }
  }
  ipcMain.on("maxcode:save-preferences", (event, value) =>
    save(event, value, false)
  )
  ipcMain.on("maxcode:save-preferences-sync", (event, value) =>
    save(event, value, true)
  )
  const handle = (name, action) => {
    ipcMain.handle(`maxcode:${name}`, (event, ...args) => {
      if (!trustedSender(event)) throw new Error("Untrusted desktop IPC sender")
      return action(BrowserWindow.fromWebContents(event.sender), ...args)
    })
  }
  handle("read-clipboard-image", () => {
    // Keep native clipboard access behind the trusted main-frame IPC check.
    // Mixed text/image content should retain ordinary text paste semantics.
    if (clipboard.readText().trim()) return null
    const image = clipboard.readImage()
    return image.isEmpty() ? null : image.toDataURL()
  })
  handle("open-external", (_window, url) =>
    shell.openExternal(externalUrl(url))
  )
  handle("open-path", async (_window, filePath) => {
    const error = await shell.openPath(localPath(filePath))
    if (error) throw new Error(error)
  })
  handle("reveal-item", (_window, filePath) =>
    shell.showItemInFolder(localPath(filePath))
  )
  handle("open-file-dialog", async (window, options = {}) => {
    const safe = dialogOptions(options)
    const result = await dialog.showOpenDialog(window, {
      ...safe,
      properties: [
        options.directory === true ? "openDirectory" : "openFile",
        ...(options.multiple === true ? ["multiSelections"] : []),
      ],
    })
    return result.canceled ? null : result.filePaths
  })
  handle("save-file", async (window, options, bytes) => {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength > 128 * 1024 * 1024
    ) {
      throw new Error("Invalid file contents (maximum 128 MiB)")
    }
    const result = await dialog.showSaveDialog(window, {
      ...dialogOptions(options),
      properties: ["createDirectory", "showOverwriteConfirmation"],
    })
    if (result.canceled || !result.filePath) return null
    await fs.promises.writeFile(result.filePath, bytes)
    return result.filePath
  })
  handle("close-window", (window) => {
    // Deliver the invoke reply before destroying the sender's renderer.
    setImmediate(() => {
      if (!window.isDestroyed()) window.close()
    })
  })
  handle("relaunch-app", () => {
    setImmediate(() => {
      app.relaunch()
      app.quit()
    })
  })
  handle("update-check", () => desktopUpdater.check())
  handle("update-status", () => desktopUpdater.status())
  handle("update-state", () => desktopUpdater.snapshot())
  handle("update-start", () => desktopUpdater.start())
  handle("update-install", () => desktopUpdater.restart())
  handle("minimize-window", (window) => window.minimize())
  handle("toggle-maximize", (window) => {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  handle("is-maximized", (window) => window.isMaximized())
  handle("set-badge-count", (_window, count) => {
    if (count != null && (!Number.isSafeInteger(count) || count < 0)) {
      throw new Error("Invalid badge count")
    }
    if (process.platform === "darwin") {
      app.dock.setBadge(count > 0 ? String(count) : "")
    }
  })
  handle("notify", (_window, title, body) => {
    if (
      typeof title !== "string" ||
      typeof body !== "string" ||
      title.length > 512 ||
      body.length > 8192
    ) {
      throw new Error("Invalid notification")
    }
    if (!Notification.isSupported()) return false
    const notification = new Notification({ title, body })
    notifications.add(notification)
    notification.once("close", () => notifications.delete(notification))
    notification.once("failed", () => notifications.delete(notification))
    notification.once("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow().catch(fatalError)
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })
    notification.show()
    return true
  })
  handle("notification-settings", async (window) => {
    if (process.platform === "darwin") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
      )
    } else if (process.platform === "win32") {
      await shell.openExternal("ms-settings:notifications")
    } else {
      await dialog.showMessageBox(window, {
        type: "info",
        message: "Notification settings",
        detail:
          "Manage MaxCode notifications in your desktop's system settings.",
      })
    }
  })
}

function installSessionSecurity() {
  const trustedContents = (contents) =>
    Boolean(contents && windows.has(BrowserWindow.fromWebContents(contents)))
  const permissions = new Set([
    "clipboard-read",
    "clipboard-sanitized-write",
    "notifications",
    "media",
  ])
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        Boolean(
          trustedContents(contents) &&
          details.isMainFrame &&
          isTrustedAppUrl(details.requestingUrl, backend.backendUrl) &&
          permissions.has(permission)
        )
      )
    }
  )
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      Boolean(
        trustedContents(contents) &&
        details.isMainFrame &&
        isTrustedUrl(requestingOrigin, backend.backendUrl) &&
        permissions.has(permission)
      )
  )
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (
      details.resourceType !== "mainFrame" ||
      !isTrustedUrl(details.url, backend.backendUrl)
    ) {
      callback({})
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; " +
            "font-src 'self' data: https:; media-src 'self' blob: data: https: http:; " +
            "connect-src 'self' https: http: ws: wss:; worker-src 'self' blob:; " +
            "frame-src https: http: blob:; object-src 'none'; base-uri 'self'; " +
            "form-action 'self'; frame-ancestors 'none'",
        ],
      },
    })
  })
}

function openAllowedExternal(url) {
  try {
    shell.openExternal(externalUrl(url)).catch(() => {})
  } catch {
    // Never forward file:, javascript:, or arbitrary protocol handlers.
  }
}

function windowOptions(workspace = false) {
  return {
    title: "MaxCode",
    ...(workspace && process.platform === "darwin"
      ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 13 } }
      : {}),
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#1b1b1a",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  }
}

function configureWindow(window) {
  windows.add(window)
  window.once("closed", () => {
    windows.delete(window)
    if (mainWindow === window) mainWindow = null
  })
  window.once("ready-to-show", () => {
    if (!smokeTest) window.show()
  })
  const keepLocal = (event, url) => {
    if (!isTrustedAppUrl(url, backend.backendUrl)) {
      event.preventDefault()
      openAllowedExternal(url)
    }
  }
  window.webContents.on("will-navigate", keepLocal)
  window.webContents.on("will-redirect", keepLocal)
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault()
  )
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Commit, push, and settings flows reserve a named about:blank WindowProxy
    // before awaiting their data, then navigate it to an app route. The blank
    // reservation gets no bridge; only its final trusted document can get one.
    if (url === "about:blank" || isTrustedAppUrl(url, backend.backendUrl)) {
      return { action: "allow", overrideBrowserWindowOptions: windowOptions() }
    }
    openAllowedExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("did-create-window", (child) => configureWindow(child))
  window.webContents.on("render-process-gone", (_event, details) => {
    if (!quitting) fatalError(new Error(`Renderer stopped: ${details.reason}`))
  })
}

async function createWindow() {
  const window = new BrowserWindow({
    ...windowOptions(true),
    ...windowState.options(),
  })
  mainWindow = window
  windowState.track(window)
  configureWindow(window)
  await window.loadURL(backend.backendUrl)
  return window
}

async function shutdown() {
  if (shutdownPromise) return shutdownPromise
  windowState.save(mainWindow)
  quitting = true
  startupAbort.abort()
  shutdownPromise = (async () => {
    for (const notification of notifications) notification.close()
    const runningBackend = backend || (await backendStartup?.catch(() => null))
    await runningBackend?.stop()
  })()
  return shutdownPromise
}

async function finishSmoke(code) {
  try {
    await shutdown()
    for (const window of windows) window.destroy()
  } catch (error) {
    code = 1
    process.stderr.write(`[electron smoke] Shutdown failed: ${error.message}\n`)
  }
  // Packaged smoke tests let the parent remove the profile after Electron exits.
  // Chromium may still hold Windows profile files open while this process lives.
  if (!process.env.CODEG_ELECTRON_SMOKE_DIR) {
    try {
      await fs.promises.rm(smokeDir, { recursive: true, force: true })
    } catch (error) {
      process.stderr.write(
        `[electron smoke] Temporary cleanup deferred: ${error.message}\n`
      )
    }
  }
  app.exit(code)
}

function fatalError(error) {
  if (quitting) return
  const message = String(error?.message || error).replaceAll(
    backend?.token || "__no_token__",
    "[redacted]"
  )
  if (smokeTest) {
    process.stderr.write(`[electron smoke] FAIL: ${message}\n`)
    finishSmoke(1).catch(() => app.exit(1))
  } else {
    dialog.showErrorBox("MaxCode could not continue", message)
    app.quit()
  }
}

async function runSmoke(window) {
  const result = await window.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline &&
      (!location.pathname.startsWith('/workspace') || !document.querySelector('button'))) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const bridge = window.maxcodeElectron
    if (!bridge || !location.pathname.startsWith('/workspace') ||
      !document.querySelector('button')) throw new Error('Workspace did not render')
    const desktopState = await bridge.getUpdateState()
    const desktopStatus = await bridge.getUpdateStatus()
    if (desktopState.status !== 'idle' || desktopStatus.runtime !== 'electron' ||
      desktopStatus.selfUpdateSupported !== false) throw new Error('Desktop updater bridge failed')
    const health = await fetch('/api/health', {
      method: 'POST', headers: { Authorization: 'Bearer ' + bridge.token }
    })
    const unauthenticated = await fetch('/api/health', { method: 'POST' })
    if (!health.ok || unauthenticated.status !== 401) throw new Error('Backend auth failed')
    const updateResponse = await fetch('/api/app_update_status', {
      method: 'POST', headers: { Authorization: 'Bearer ' + bridge.token }
    })
    const update = await updateResponse.json()
    if (!updateResponse.ok || update.runtime !== 'electron' ||
      update.selfUpdateSupported !== false || update.rollbackAvailable !== false) {
      throw new Error('Electron update capability contract failed')
    }
    if (typeof window.require !== 'undefined' || localStorage.getItem('codeg_token')) {
      throw new Error('Renderer isolation or credential storage failed')
    }
    localStorage.setItem('electron-smoke-preference', 'preserved')
    const child = window.open('', 'electron-smoke-child')
    if (!child) throw new Error('Named child window reservation failed')
    child.location.href = '/workspace?electronSmoke=child'
    const childDeadline = Date.now() + 10000
    while (Date.now() < childDeadline && !child.maxcodeElectron) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!child.maxcodeElectron || child.maxcodeElectron.token !== bridge.token ||
      typeof await child.maxcodeElectron.isMaximized() !== 'boolean' ||
      localStorage.getItem('electron-smoke-preference') !== 'preserved') {
      throw new Error('Child bridge or shared preferences failed')
    }
    await child.maxcodeElectron.closeWindow()
    const closeDeadline = Date.now() + 5000
    while (!child.closed && Date.now() < closeDeadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!child.closed) throw new Error('Child close did not target its own window')
    localStorage.removeItem('electron-smoke-preference')
    await new Promise((resolve, reject) => {
      const encoded = btoa(bridge.token).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '')
      const socket = new WebSocket(bridge.backendUrl.replace(/^http/, 'ws') + '/ws/events',
        ['codeg-events', 'codeg-token.' + encoded])
      const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket timeout')) }, 5000)
      socket.onmessage = event => {
        if (JSON.parse(event.data).channel === '__ready__') {
          clearTimeout(timer); socket.close(); resolve()
        }
      }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket failed')) }
    })
    return { workspace: true, authenticatedHttp: true, authenticatedWebSocket: true,
      electronUpdateCapabilities: true,
      nativeChildWindows: true, sharedPreferences: true,
      sandbox: typeof window.require === 'undefined', platform: bridge.platform }
  })()`)
  // Exercise the same same-origin <a download> path used by backup/file
  // exports. It must download without navigating a privileged app window.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.defaultSession.removeListener("will-download", onDownload)
      reject(new Error("Native download did not complete"))
    }, 5000)
    const onDownload = (_event, item, contents) => {
      if (contents !== window.webContents) return
      session.defaultSession.removeListener("will-download", onDownload)
      item.setSavePath(path.join(smokeDir, "download.png"))
      item.once("done", (_event, state) => {
        clearTimeout(timer)
        if (state === "completed") resolve()
        else reject(new Error(`Native download ${state}`))
      })
    }
    session.defaultSession.on("will-download", onDownload)
    window.webContents
      .executeJavaScript(
        `(() => {
      const anchor = document.createElement('a')
      anchor.href = '/icon-32x32.png'
      anchor.download = 'maxcode-smoke.png'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    })()`
      )
      .catch(reject)
  })
  result.nativeDownloads = true
  if (process.env.CODEG_ELECTRON_SMOKE_SCREENSHOT) {
    const screenshot = await window.webContents.capturePage()
    await fs.promises.writeFile(
      path.resolve(process.env.CODEG_ELECTRON_SMOKE_SCREENSHOT),
      screenshot.toPNG()
    )
  }
  process.stdout.write(`[electron smoke] PASS ${JSON.stringify(result)}\n`)
  await finishSmoke(0)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (backend && !quitting) createWindow().catch(fatalError)
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.on("before-quit", (event) => {
    if (quitting) return
    event.preventDefault()
    shutdown()
      .then(() => app.quit())
      .catch(() => app.exit(1))
  })
  app.on("window-all-closed", () => {
    if (!quitting && (process.platform !== "darwin" || smokeTest)) app.quit()
  })
  app.on("activate", () => {
    if (backend && !mainWindow && !quitting) createWindow().catch(fatalError)
  })
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => app.quit())
  }
  app
    .whenReady()
    .then(async () => {
      const root = path.resolve(__dirname, "..")
      const executable =
        (!app.isPackaged && process.env.CODEG_ELECTRON_BACKEND_PATH) ||
        path.join(
          app.isPackaged
            ? path.join(process.resourcesPath, "backend")
            : path.join(root, "src-tauri", "target", "debug"),
          process.platform === "win32" ? "codeg-server.exe" : "codeg-server"
        )
      const staticDir = app.isPackaged
        ? path.join(process.resourcesPath, "web")
        : process.env.CODEG_ELECTRON_STATIC_DIR || path.join(root, "out")
      const dataDir = smokeDir
        ? path.join(smokeDir, "data")
        : legacyDataDir(app)
      try {
        preferences = sanitizeStorage(
          JSON.parse(fs.readFileSync(preferencesFile, "utf8"))
        )
      } catch {
        preferences = {}
      }
      backendStartup = startBackend({
        executable: path.resolve(executable),
        staticDir: path.resolve(staticDir),
        dataDir,
        codegHome: smokeDir ? dataDir : undefined,
        signal: startupAbort.signal,
        onExit: (error) => {
          if (!starting && !quitting) fatalError(error)
        },
      })
      backend = await backendStartup
      starting = false
      if (quitting) {
        await backend.stop()
        return
      }
      const { autoUpdater } = require("electron-updater")
      const { createDesktopUpdater } = require("./updater.cjs")
      let recoveringUpdate = false
      desktopUpdater = createDesktopUpdater({
        updater: autoUpdater,
        version: app.getVersion(),
        enabled:
          app.isPackaged &&
          !smokeTest &&
          (process.platform === "darwin"
            ? require("./package.json").desktopUpdates === true
            : process.platform === "win32" || Boolean(process.env.APPIMAGE)),
        emit: (state) => {
          for (const window of windows) {
            if (
              !window.isDestroyed() &&
              isTrustedAppUrl(window.webContents.getURL(), backend.backendUrl)
            ) {
              window.webContents.send("maxcode:update-state", state)
            }
          }
        },
        beforeInstall: shutdown,
        onInstallError: (error) => {
          if (!quitting || recoveringUpdate) return
          recoveringUpdate = true
          dialog.showErrorBox(
            "MaxCode update failed",
            String(error.message || error)
          )
          app.relaunch()
          app.exit(1)
        },
      })
      installBridge()
      installSessionSecurity()
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
          { role: "fileMenu" },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ])
      )
      const window = await createWindow()
      if (smokeTest) await runSmoke(window)
    })
    .catch(fatalError)
}
