import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import manifest from "@/app/manifest"
import { repoPath, source, sourceExists } from "./contract-source"

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
  it("highlights the update action in blue in both themes", () => {
    const status = source("src/components/layout/status-bar-update.tsx")
    expect(status).toContain("rounded-full")
    expect(status).toContain("bg-blue-600")
    expect(status).toContain("dark:bg-blue-500")
  })

  it("uses the personal MaxCode release feed and removes overlapping update toasts", () => {
    const config = source("electron/electron-builder.cjs")
    expect(config).toContain('productName: "MaxCode"')
    const feed = source("electron/update-config.cjs")
    expect(feed).toContain('owner: "Nothing-129"')
    expect(feed).toContain('repo: "maxcode"')
    const status = source("src/components/layout/status-bar-update.tsx")
    expect(status).not.toMatch(/\btoast[.(]/)
    expect(status).toContain("<ArrowDown")
  })

  it("keeps signed server updates and explicit platform whitelists", () => {
    const workflow = source(".github/workflows/release.yml")
    expect(workflow).toContain("DESKTOP_TARGETS:")
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY")
    expect(workflow).toContain("Require server updater signing key")
    expect(workflow).toContain("release.cjs validate-assets")
  })

  it("keeps fork branding and installers on the user's repository", () => {
    expect(source("README.md")).toMatch(/^# MaxCode/m)
    expect(source("install.sh")).toContain('REPO="Nothing-129/maxcode"')
    expect(source("install.ps1")).toContain('$Repo = "Nothing-129/maxcode"')
    expect(sourceExists("public/icon.svg")).toBe(true)
    expect(sourceExists("src-tauri/icons/icon.icns")).toBe(true)
  })

  it("uses MaxCode in localized product prose and documentation", () => {
    const oldProductName = /(?<![A-Za-z0-9_./-])codeg(?![A-Za-z0-9_./-])/i
    const checkProse = (value: unknown, path: string) => {
      if (typeof value === "string") {
        // Real identifiers such as CODEG_LOG, ~/.codeg and codeg-mcp stay valid.
        expect(value, path).not.toMatch(oldProductName)
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          checkProse(child, `${path}.${key}`)
        }
      }
    }
    for (const file of readdirSync(repoPath("src/i18n/messages"))) {
      if (file.endsWith(".json")) {
        checkProse(JSON.parse(source(`src/i18n/messages/${file}`)), file)
      }
    }
    for (const file of readdirSync(repoPath("docs/readme"))) {
      if (file.startsWith("README.") && file.endsWith(".md")) {
        expect(source(`docs/readme/${file}`)).toMatch(/^# MaxCode\n/)
      }
    }
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      expect(source(file)).toContain("MaxCode 是一个多智能体编码工作台")
    }
  })

  it("keeps product readmes free of sponsor promotions", () => {
    const readmes = [
      "README.md",
      ...readdirSync(repoPath("docs/readme"))
        .filter((file) => file.startsWith("README.") && file.endsWith(".md"))
        .map((file) => `docs/readme/${file}`),
    ]
    for (const path of readmes) {
      expect(source(path), path).not.toMatch(
        /readme_sponsor|sponsor_cta|^## 💖|compshare\.cn|sui-xiang\.com|hezu\.ink|onehop\.ai|lqapi\.xyz|mailto:itpkcn@gmail\.com/m
      )
    }
  })

  it("keeps the custom layered-terminal macOS icon", () => {
    const icon = readFileSync(repoPath("src-tauri/icons/icon.icns"))
    expect(createHash("sha256").update(icon).digest("hex")).toBe(
      "2336a914b5bb8623b487b93dd9e1c4bca45c55c2020046268009143218c5b798"
    )
  })

  it("keeps notification titles and every locale's test notification on MaxCode", () => {
    for (const path of [
      "src/contexts/acp-connections-context.tsx",
      "src/contexts/tasks-view-context.tsx",
    ]) {
      const content = source(path)
      expect(content).toContain(' - MaxCode` : "MaxCode"')
      expect(content).not.toMatch(/ - Codeg`|: "Codeg"/)
    }
    for (const locale of [
      "ar",
      "de",
      "en",
      "es",
      "fr",
      "ja",
      "ko",
      "pt",
      "zh-CN",
      "zh-TW",
    ]) {
      const messages = source(`src/i18n/messages/${locale}.json`)
      expect(messages).toContain('"testTitle": "MaxCode"')
    }
    expect(source("electron/main.cjs")).toContain("new Notification(")
  })
})
