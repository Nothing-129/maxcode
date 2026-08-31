import { describe, expect, it } from "vitest"

import manifest from "@/app/manifest"
import { source, sourceExists } from "./contract-source"

describe("MaxCode contract: resilient web installation", () => {
  it("ships a standalone MaxCode PWA with any and maskable icons", () => {
    const value = manifest()
    expect(value.name).toBe("MaxCode")
    expect(value.display).toBe("standalone")
    expect(value.icons?.some((icon) => icon.purpose === "any")).toBe(true)
    expect(value.icons?.some((icon) => icon.purpose === "maskable")).toBe(true)
    expect(source("src/components/pwa-register.tsx")).toContain(
      'navigator.serviceWorker.register("/sw.js", { scope: "/" })'
    )
    expect(sourceExists("public/sw.js")).toBe(true)
  })

  it("preserves credentials on network loss and only expires authenticated 401s", () => {
    const transport = source("src/lib/transport/web-transport.ts")
    expect(transport).toContain("if (token) this.markUnauthorized()")
    expect(transport).toContain('this.setConnState("reconnecting")')
    expect(transport).toContain("void this.probeHealth()")
    expect(transport).toContain("`${this.baseUrl}/api/health`")
  })
})

describe("MaxCode contract: updater and release channel", () => {
  it("uses the personal MaxCode release feed and removes overlapping update toasts", () => {
    const config = JSON.parse(source("src-tauri/tauri.conf.json")) as {
      productName: string
      plugins: { updater: { endpoints: string[] } }
    }
    expect(config.productName).toBe("MaxCode")
    expect(config.plugins.updater.endpoints).toEqual([
      "https://github.com/Nothing-129/maxcode/releases/latest/download/latest.json",
    ])
    const status = source("src/components/layout/status-bar-update.tsx")
    expect(status).toContain("toast.dismiss(updateToastId(availableVersion))")
  })

  it("keeps signed updater artifacts and explicit platform whitelists", () => {
    const workflow = source(".github/workflows/release.yml")
    expect(workflow).toContain("DESKTOP_TARGETS:")
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY")
    expect(workflow).toContain("latest.json missing")
    expect(workflow).toContain("no updater .sig artifacts")
  })

  it("keeps fork branding and installers on the user's repository", () => {
    expect(source("README.md")).toMatch(/^# MaxCode/m)
    expect(source("install.sh")).toContain('REPO="Nothing-129/maxcode"')
    expect(source("install.ps1")).toContain('$Repo = "Nothing-129/maxcode"')
    expect(sourceExists("public/icon.svg")).toBe(true)
    expect(sourceExists("src-tauri/icons/icon.icns")).toBe(true)
  })
})
