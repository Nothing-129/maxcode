import { readdirSync } from "node:fs"
import { afterEach, describe, expect, it } from "vitest"
import { detectEnvironment } from "@/lib/transport/detect"
import { repoPath, source, sourceExists } from "./contract-source"

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
})

describe("MaxCode contract: retired Tauri desktop cannot return", () => {
  it("keeps browser clients on HTTP even with a legacy runtime marker", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    })
    expect(detectEnvironment()).toBe("web")
  })

  it("ships only Electron desktop commands and shared Rust binaries", () => {
    const manifest = JSON.parse(source("package.json"))
    expect(manifest.scripts["desktop:dev"]).toBe(
      "node electron/scripts/cli.mjs dev"
    )
    expect(
      Object.keys(manifest.scripts).filter((name) =>
        /^(legacy:)?tauri(?::|$)/.test(name)
      )
    ).toEqual([])
    expect(
      Object.keys(manifest.dependencies).filter((name) =>
        name.startsWith("@tauri-apps/")
      )
    ).toEqual([])
    const cargo = source("src-tauri/Cargo.toml")
    expect(cargo).toContain("default = []")
    expect(cargo).toContain('name = "codeg-server"')
    expect(cargo).toContain('name = "codeg-mcp"')
    expect(cargo).toContain('native-keyring = ["dep:keyring"]')
    expect(cargo).not.toMatch(/tauri-runtime|tauri-build|tauri-plugin-/)
    expect(sourceExists("src-tauri/src/main.rs")).toBe(false)
    expect(sourceExists("src-tauri/tauri.conf.json")).toBe(false)
    expect(sourceExists(".github/workflows/legacy-tauri.yml")).toBe(false)
  })

  it("keeps the existing server signing tool and credential compatibility", () => {
    const manifest = JSON.parse(source("package.json"))
    expect(manifest.scripts["server:sign"]).toBe("tauri signer sign")
    expect(manifest.devDependencies["@tauri-apps/cli"]).toBeDefined()
    expect(source(".github/workflows/release.yml")).toContain(
      "pnpm server:sign"
    )
    expect(source("electron/runtime.cjs")).toContain("app.codeg")
    expect(source("electron/scripts/cli.mjs")).toContain('"native-keyring"')
    expect(sourceExists("src-tauri/icons/icon.icns")).toBe(true)
  })

  it("removes retired desktop surfaces and runtime imports", () => {
    for (const path of [
      "src/app/pet",
      "src/app/pet-panel",
      "src/components/settings/pet-manager-section.tsx",
      "src/components/layout/remote-workspace-manage-dialog.tsx",
      "src/lib/transport/tauri-transport.ts",
      "src/lib/transport/remote-desktop-transport.ts",
    ]) {
      expect(sourceExists(path), path).toBe(false)
    }
    expect(
      source("src/components/settings/system-network-settings.tsx")
    ).not.toMatch(/getAutostartSettings|setAutostartSettings|autostartVisible/)
    const checkDirectory = (path: string) => {
      for (const entry of readdirSync(repoPath(path), {
        withFileTypes: true,
      })) {
        const child = `${path}/${entry.name}`
        if (entry.isDirectory()) checkDirectory(child)
        else if (
          /\.[jt]sx?$/.test(entry.name) &&
          !entry.name.includes(".test.")
        ) {
          expect(source(child), child).not.toContain("@tauri-apps/")
        }
      }
    }
    checkDirectory("src")
  })
})
