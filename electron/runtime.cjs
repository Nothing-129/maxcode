/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const { spawn, execFile } = require("node:child_process")
const { randomBytes } = require("node:crypto")

const MAX_STORAGE_BYTES = 5 * 1024 * 1024
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))
const APP_PATHS = new Set([
  "/",
  "/workspace",
  "/settings",
  "/commit",
  "/merge",
  "/push",
  "/stash",
  "/project-boot",
  "/import-sessions",
  "/pet",
  "/pet-panel",
])
const SETTINGS_PAGES = new Set([
  "agents",
  "appearance",
  "chat-channels",
  "experts",
  "general",
  "logs",
  "mcp",
  "model-providers",
  "office-tools",
  "quick-messages",
  "science",
  "shortcuts",
  "skill-packs",
  "skills",
  "system",
  "version-control",
  "web-service",
])

function isTrustedUrl(value, backendUrl) {
  try {
    const url = new URL(value)
    return (
      url.origin === backendUrl &&
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

function isTrustedAppUrl(value, backendUrl) {
  if (!isTrustedUrl(value, backendUrl)) return false
  const pathname = new URL(value).pathname.replace(/\/$/, "") || "/"
  return (
    APP_PATHS.has(pathname) ||
    (pathname.startsWith("/settings/") &&
      SETTINGS_PAGES.has(pathname.slice("/settings/".length)))
  )
}

function externalUrl(value) {
  if (typeof value !== "string" || value.length > 8192) {
    throw new Error("Invalid external URL")
  }
  const url = new URL(value)
  if (
    !["https:", "http:", "mailto:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Unsupported external URL")
  }
  return url.href
}

function localPath(value) {
  if (
    typeof value !== "string" ||
    value.length > 32768 ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  ) {
    throw new Error("Expected an absolute local path")
  }
  return value
}

function dialogOptions(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid dialog options")
  }
  const options = {}
  for (const key of ["title", "defaultPath"]) {
    if (value[key] !== undefined) {
      if (
        typeof value[key] !== "string" ||
        value[key].length > 32768 ||
        value[key].includes("\0")
      ) {
        throw new Error(`Invalid dialog ${key}`)
      }
      options[key] = value[key]
    }
  }
  if (value.filters !== undefined) {
    if (!Array.isArray(value.filters) || value.filters.length > 32) {
      throw new Error("Invalid file filters")
    }
    options.filters = value.filters.map((filter) => {
      if (
        !filter ||
        typeof filter.name !== "string" ||
        filter.name.length > 256 ||
        !Array.isArray(filter.extensions) ||
        filter.extensions.length === 0 ||
        filter.extensions.length > 64 ||
        !filter.extensions.every(
          (extension) =>
            typeof extension === "string" &&
            /^(\*|[a-zA-Z0-9_-]{1,32})$/.test(extension)
        )
      ) {
        throw new Error("Invalid file filter")
      }
      return { name: filter.name, extensions: [...filter.extensions] }
    })
  }
  return options
}

function sanitizeStorage(value, token = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid renderer preferences")
  }
  const entries = Object.entries(value).filter(
    ([key, item]) =>
      key !== "codeg_token" &&
      typeof item === "string" &&
      (!token || !item.includes(token))
  )
  const result = Object.fromEntries(entries)
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_STORAGE_BYTES) {
    throw new Error("Renderer preferences exceed the size limit")
  }
  return result
}

function legacyDataDir(app, env = process.env, platform = process.platform) {
  if (env.CODEG_DATA_DIR) {
    return path.resolve(env.CODEG_DATA_DIR)
  }
  const base =
    platform === "linux"
      ? env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share")
      : app.getPath("appData")
  return path.join(base, "app.codeg")
}

// Finder/LaunchServices does not inherit the terminal's PATH. Import only PATH
// from the user's login shell, with a bounded probe and standard install dirs
// as a fallback (notably the official Node installer at /usr/local/bin).
async function desktopEnvironment(
  env = process.env,
  platform = process.platform
) {
  if (platform === "win32") return { ...env }
  const shell = env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/sh")
  const marker = "MAXCODE_DESKTOP_PATH="
  const shellPath = await new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '\n${marker}%s\n' "$PATH"`],
      { env, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve("")
        const line = stdout
          .split("\n")
          .findLast((value) => value.startsWith(marker))
        resolve(line ? line.slice(marker.length) : "")
      }
    )
  })
  const directories = [
    ...shellPath.split(":"),
    ...(env.PATH || "").split(":"),
    ...(platform === "darwin"
      ? ["/opt/homebrew/bin", "/opt/homebrew/sbin"]
      : []),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter((directory) => path.isAbsolute(directory))
  return { ...env, PATH: [...new Set(directories)].join(":") }
}

async function startBackend({
  executable,
  staticDir,
  dataDir,
  codegHome,
  onExit,
  signal,
}) {
  await fs.promises.access(executable, fs.constants.X_OK)
  await fs.promises.access(path.join(staticDir, "index.html"))
  const readyDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "maxcode-electron-")
  )
  await fs.promises.chmod(readyDir, 0o700)
  const readyFile = path.join(readyDir, "ready.json")
  const token = randomBytes(32).toString("hex")
  let stopping = false
  let exited = false
  let failure = null
  let output = ""
  const environment = await desktopEnvironment()
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...environment,
      CODEG_RUNTIME: "electron",
      CODEG_HOST: "127.0.0.1",
      CODEG_PORT: "0",
      CODEG_TOKEN: token,
      CODEG_DATA_DIR: dataDir,
      ...(codegHome ? { CODEG_HOME: codegHome } : {}),
      CODEG_STATIC_DIR: staticDir,
      CODEG_ELECTRON_READY_FILE: readyFile,
    },
  })
  const record = (chunk) => {
    const safe = chunk.toString().replaceAll(token, "[redacted]")
    output = (output + safe).slice(-12000)
    process.stderr.write(safe)
  }
  child.stdout.on("data", record)
  child.stderr.on("data", record)
  child.stdin.on("error", () => {})
  child.on("error", (error) => {
    failure = error
    exited = true
  })
  child.once("exit", (code, signal) => {
    exited = true
    failure = new Error(
      `Backend exited (${signal || code}).\n${output.replaceAll(token, "[redacted]")}`
    )
    if (!stopping) onExit?.(failure)
  })

  let stopPromise
  const stop = () => {
    if (stopPromise) return stopPromise
    stopping = true
    stopPromise = (async () => {
      if (!exited && child.pid) {
        // EOF is portable, and also lets the backend stop if Electron crashes.
        child.stdin.end()
        const deadline = Date.now() + 8000
        while (!exited && Date.now() < deadline) await wait(50)
      }
      // The server drains its agents on SIGTERM. Kill the owned process group
      // as a backstop for stuck descendants, including after the parent exits.
      if (child.pid) {
        if (process.platform === "win32") {
          if (!exited) {
            await new Promise((resolve) => {
              const killer = spawn(
                "taskkill",
                ["/PID", String(child.pid), "/T", "/F"],
                { windowsHide: true, stdio: "ignore" }
              )
              killer.once("error", resolve)
              killer.once("exit", resolve)
            })
          }
        } else {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch (error) {
            if (error.code !== "ESRCH") throw error
          }
        }
      }
      await fs.promises.rm(readyDir, { recursive: true, force: true })
    })()
    return stopPromise
  }

  try {
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("Backend startup canceled")
      if (failure) throw failure
      try {
        const ready = JSON.parse(await fs.promises.readFile(readyFile, "utf8"))
        if (
          !Number.isInteger(ready.port) ||
          ready.port < 1 ||
          ready.port > 65535
        ) {
          throw new Error("Backend published an invalid port")
        }
        const backendUrl = `http://127.0.0.1:${ready.port}`
        const response = await fetch(`${backendUrl}/api/health`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) return { backendUrl, token, stop }
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof TypeError)) {
          throw error
        }
      }
      await wait(100)
    }
    throw new Error(
      `Backend did not become ready within 45 seconds.\n${output}`
    )
  } catch (error) {
    await stop()
    throw error
  }
}

module.exports = {
  desktopEnvironment,
  dialogOptions,
  externalUrl,
  isTrustedAppUrl,
  isTrustedUrl,
  legacyDataDir,
  localPath,
  sanitizeStorage,
  startBackend,
}
