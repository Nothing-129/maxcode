import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"

const script = fileURLToPath(import.meta.url)
const root = resolve(dirname(script), "../..")
const require = createRequire(join(root, "electron/main.cjs"))
const runtime = require("./runtime.cjs")

// Test the ordinary main-process initialization and real Rust migration, not
// --smoke-test (which intentionally skips legacy data). Packaged smoke tests
// separately verify Chromium, the workspace UI and native bridges.
if (process.argv[2] !== "--worker") {
  const fixture = mkdtempSync(join(tmpdir(), "maxcode-upgrade-"))
  try {
    const home = join(fixture, "home")
    mkdirSync(home)
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_DATA_HOME: join(fixture, "data"),
      XDG_CACHE_HOME: join(fixture, "cache"),
      APPDATA: join(fixture, "data"),
      LOCALAPPDATA: join(fixture, "local"),
    }
    for (const key of [
      "MAXCODE_DATA_DIR",
      "CODEG_DATA_DIR",
      "MAXCODE_HOME",
      "CODEG_HOME",
      "CODEG_PUBLIC_URL",
      "ELECTRON_RUN_AS_NODE",
    ])
      delete env[key]
    const result = spawnSync(process.execPath, [script, "--worker", fixture], {
      cwd: root,
      env,
      stdio: "inherit",
      timeout: 180_000,
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    rmSync(fixture, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
} else {
  const fixture = process.argv[3]
  const executable =
    process.env.MAXCODE_UPGRADE_BACKEND ||
    join(
      root,
      "electron/.staging/backend",
      process.platform === "win32" ? "codeg-server.exe" : "codeg-server"
    )
  const staticDir = process.env.MAXCODE_UPGRADE_WEB || join(root, "out")
  const profile = join(fixture, "profile")
  const appData = join(fixture, "data")
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    getPath: (name) =>
      name === "home"
        ? join(fixture, "home")
        : name === "userData"
          ? profile
          : appData,
    setName() {},
    setAppUserModelId() {},
    enableSandbox() {},
    quit() {},
    getVersion: () => "upgrade-test",
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
  })
  const target = runtime.desktopDataDir(app)
  const legacy = join(dirname(target), "app.codeg")
  const home = join(fixture, "private-home")
  const request = async (backend, route, body = {}) => {
    const response = await fetch(`${backend.backendUrl}/api/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${backend.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    assert.ok(response.ok, `${route}: HTTP ${response.status}`)
    return response.json()
  }
  let backend
  const startupAbort = new AbortController()
  process.once("SIGTERM", async () => {
    startupAbort.abort()
    if (backend) await backend.stop()
    process.exit(1)
  })
  try {
    backend = await runtime.startBackend({
      executable,
      staticDir,
      dataDir: legacy,
      codegHome: home,
      signal: startupAbort.signal,
      onExit() {},
    })
    const project = join(fixture, "project")
    mkdirSync(project)
    const folder = await request(backend, "add_folder_to_history", {
      path: project,
    })
    const conversationId = await request(backend, "create_conversation", {
      folderId: folder.id,
      agentType: "codex",
      title: "Retained upgrade conversation",
    })
    const socket = createServer()
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve))
    const port = socket.address().port
    await new Promise((resolve) => socket.close(resolve))
    const config = {
      port,
      token: randomUUID(),
      autoStart: true,
      publicShareUrl: "https://upgrade.example.test",
    }
    await request(backend, "update_web_service_config", { config })
    await backend.stop()
    backend = null
    mkdirSync(join(legacy, "uploads"), { recursive: true })
    writeFileSync(join(legacy, "uploads/retained.txt"), "retained attachment")
    const before = readFileSync(join(legacy, "codeg.db"))

    async function ordinaryStart(expectedSource) {
      let resolveReady, rejectReady
      const ready = new Promise((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      const desktopProcess = Object.assign(new EventEmitter(), {
        argv: ["maxcode"],
        platform: process.platform,
        pid: process.pid,
        env: {
          ...process.env,
          CODEG_ELECTRON_BACKEND_PATH: executable,
          CODEG_ELECTRON_STATIC_DIR: staticDir,
        },
      })
      const entry = join(root, "electron/main.cjs")
      runInNewContext(readFileSync(entry, "utf8"), {
        __dirname: dirname(entry),
        process: desktopProcess,
        AbortController,
        require: (id) => {
          if (id === "electron")
            return {
              app,
              screen: {},
              dialog: {
                showErrorBox: (_title, error) => rejectReady(new Error(error)),
              },
            }
          if (id === "./runtime.cjs")
            return {
              ...runtime,
              startBackend: async (options) => {
                try {
                  assert.equal(options.legacySource, expectedSource)
                  backend = await runtime.startBackend({
                    ...options,
                    codegHome: home,
                    signal: AbortSignal.any([
                      options.signal,
                      startupAbort.signal,
                    ]),
                  })
                  resolveReady(backend)
                } catch (error) {
                  rejectReady(error)
                }
                // Stop at the backend-ready boundary; window rendering is covered
                // by desktop:smoke. The real ordinary startup path above is intact.
                return new Promise(() => {})
              },
            }
          return require(id)
        },
      })
      return ready
    }

    await ordinaryStart(legacy)
    assert.ok(existsSync(join(target, ".maxcode-layout-complete")))
    assert.equal(
      readFileSync(join(target, "uploads/retained.txt"), "utf8"),
      "retained attachment"
    )
    assert.deepEqual(readFileSync(join(legacy, "codeg.db")), before)
    assert.deepEqual(await request(backend, "get_web_service_config"), config)
    const folders = await request(backend, "load_folder_history")
    assert.ok(folders.some((entry) => entry.id === folder.id))
    const database = new DatabaseSync(join(target, "codeg.db"), {
      readOnly: true,
    })
    assert.equal(
      database
        .prepare("SELECT title FROM conversation WHERE id=?")
        .get(conversationId).title,
      "Retained upgrade conversation"
    )
    database.close()
    const web = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(15_000),
    })
    assert.ok(
      web.ok,
      "Original Web token must authenticate the restored listener"
    )
    const edited = { ...config, publicShareUrl: "https://edited.example.test" }
    await request(backend, "update_web_service_config", { config: edited })
    await backend.stop()
    backend = null
    await ordinaryStart(undefined)
    assert.deepEqual(await request(backend, "get_web_service_config"), edited)
    assert.deepEqual(readFileSync(join(legacy, "codeg.db")), before)
    console.log(
      "[upgrade smoke] PASS: ordinary startup, project, conversation, attachment, Web config/auth, source integrity and repeat launch"
    )
  } finally {
    if (backend) await backend.stop()
  }
}
