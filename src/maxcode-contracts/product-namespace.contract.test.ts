// @vitest-environment node
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { EventEmitter } from "node:events"
import { runInNewContext } from "node:vm"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { source } from "./contract-source"

const require = createRequire(import.meta.url)
const runtime = require("../../electron/runtime.cjs")
const directories: string[] = []
afterEach(() =>
  directories
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }))
)

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "maxcode-namespace-"))
  directories.push(root)
  const app = {
    getPath: (name: string) => (name === "home" ? join(root, "home") : root),
  }
  return {
    root,
    app,
    source: join(root, "app.codeg"),
    target: join(root, "app.codeg"),
  }
}

describe("MaxCode retains the original configuration directories", () => {
  it("initializes ordinary desktop startup and logs in the existing data directory", () => {
    const { app, target } = fixture()
    const entry = join(process.cwd(), "electron/main.cjs")
    const entryRequire = createRequire(entry)
    let quit = false
    const desktopApp = Object.assign(new EventEmitter(), app, {
      setName() {},
      setAppUserModelId() {},
      enableSandbox() {},
      getVersion: () => "test",
      requestSingleInstanceLock: () => false,
      quit: () => {
        quit = true
      },
    })
    const desktopProcess = Object.assign(new EventEmitter(), {
      argv: ["maxcode"],
      env: {},
      platform: "darwin",
      pid: process.pid,
    })
    runInNewContext(readFileSync(entry, "utf8"), {
      require: (id: string) => {
        if (id === "electron") return { app: desktopApp, screen: {} }
        if (id === "./runtime.cjs")
          return {
            ...runtime,
            legacyDataDir: (value: typeof app) =>
              runtime.legacyDataDir(value, {}, "darwin"),
          }
        return entryRequire(id)
      },
      process: desktopProcess,
      AbortController,
    })
    expect(quit).toBe(true)
    expect(
      JSON.parse(readFileSync(join(target, "logs/desktop.log"), "utf8"))
    ).toMatchObject({ event: "desktop-start", version: "test" })
  })

  it("uses the original directories and credentials without migration", () => {
    const { app, target } = fixture()
    expect(runtime.legacyDataDir(app, {}, "darwin")).toBe(target)
    const custom = join(target, "custom")
    expect(
      runtime.legacyDataDir(app, { CODEG_DATA_DIR: custom }, "darwin")
    ).toBe(custom)
    expect(runtime.legacyImportSource).toBeUndefined()
    expect(source("src-tauri/src/paths.rs")).toContain(
      'CODEG_DIR_NAME: &str = ".codeg"'
    )
    expect(source("src-tauri/src/keyring_store.rs")).toContain(
      'SERVICE_NAME: &str = "codeg"'
    )
    expect(source("src-tauri/src/bin/codeg_server.rs")).not.toContain(
      "migrate_desktop_layout"
    )
    expect(source("electron/main.cjs")).not.toContain("legacySource")
  })

  it("keeps the existing signed application identity distinct from upstream Codeg", () => {
    const packaging = require("../../electron/electron-builder.cjs")
    expect(packaging.appId).toBe("app.codeg.electron")
    expect(packaging.appId).not.toBe("app.codeg")
    expect(packaging.productName).toBe("MaxCode")
    expect(source("electron/update-config.cjs")).toContain("Nothing-129")
    expect(source("src-tauri/src/web/mod.rs")).toContain(
      "DEFAULT_WEB_SERVICE_PORT: u16 = 3080"
    )
  })
})
