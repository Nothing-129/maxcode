// @vitest-environment node
import { createRequire } from "node:module"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
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
    getPath: (name: string) =>
      name === "home"
        ? join(root, "home")
        : name === "userData"
          ? join(root, "profile")
          : root,
  }
  return {
    root,
    app,
    source: join(root, "app.codeg"),
    target: join(root, "app.maxcode"),
  }
}

describe("MaxCode owns a separate product namespace", () => {
  it("logs ordinary startup without making legacy data ineligible for migration", () => {
    const { app, source: old, target } = fixture()
    mkdirSync(old)
    writeFileSync(join(old, "codeg.db"), "legacy data")
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
            desktopDataDir: (value: typeof app) =>
              runtime.desktopDataDir(value, {}, "darwin"),
          }
        return entryRequire(id)
      },
      process: desktopProcess,
      AbortController,
    })
    expect(quit).toBe(true)
    expect(
      JSON.parse(
        readFileSync(join(app.getPath("userData"), "logs/desktop.log"), "utf8")
      )
    ).toMatchObject({ event: "desktop-start", version: "test" })
    expect(existsSync(target)).toBe(false)
    expect(runtime.legacyImportSource(app, {}, "darwin")).toBe(old)
    // Early failure diagnostics must not prevent migration on the next launch.
    desktopProcess.emit(
      "uncaughtExceptionMonitor",
      new Error("startup failed"),
      "test"
    )
    expect(existsSync(target)).toBe(false)
    expect(runtime.legacyImportSource(app, {}, "darwin")).toBe(old)
  })

  it("uses its own default directory and prioritizes MAXCODE overrides", () => {
    const { app, target } = fixture()
    expect(runtime.desktopDataDir(app, {}, "darwin")).toBe(target)
    expect(
      runtime.desktopDataDir(
        app,
        { MAXCODE_DATA_DIR: target, CODEG_DATA_DIR: "/other" },
        "darwin"
      )
    ).toBe(target)
    expect(
      runtime.desktopDataDir(app, { CODEG_DATA_DIR: target }, "darwin")
    ).toBe(target)
  })

  it("imports defaults once, resumes partial layout imports, and respects existing data", () => {
    const { app, source: old, target } = fixture()
    mkdirSync(old)
    writeFileSync(join(old, "codeg.db"), "fixture")
    expect(runtime.legacyImportSource(app, {}, "darwin")).toBe(old)
    expect(
      runtime.legacyImportSource(app, { MAXCODE_DATA_DIR: target }, "darwin")
    ).toBeUndefined()
    mkdirSync(target)
    expect(runtime.legacyImportSource(app, {}, "darwin")).toBeUndefined()
    writeFileSync(join(target, ".maxcode-imported-from-codeg.json"), "{}")
    expect(runtime.legacyImportSource(app, {}, "darwin")).toBe(old)
    writeFileSync(join(target, ".maxcode-layout-complete"), "1")
    expect(runtime.legacyImportSource(app, {}, "darwin")).toBeUndefined()
  })

  it("registers executable migration and credential isolation contracts", () => {
    expect(source(".github/workflows/release.yml")).toContain(
      "run: pnpm desktop:upgrade-smoke"
    )
    expect(source(".github/workflows/test.yml")).toContain(
      "run: pnpm desktop:upgrade-smoke"
    )
    expect(source("src-tauri/src/namespace.rs")).toContain(
      "product-namespace.contract.rs"
    )
    expect(source("src-tauri/src/keyring_store.rs")).toContain(
      "product-credentials.contract.rs"
    )
    expect(source("src-tauri/src/namespace.rs")).toContain(
      'KEYRING_SERVICE: &str = "maxcode"'
    )
    expect(source("src-tauri/src/commands/experts.rs")).toContain(
      "crate::paths::codeg_home_dir()"
    )
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
