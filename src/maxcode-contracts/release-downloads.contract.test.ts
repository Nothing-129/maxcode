// @vitest-environment node
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const {
  releaseDownloads,
  desktopAssets,
} = require("../../electron/scripts/release.cjs")

describe("release download table", () => {
  it("links only selected DMG and EXE installers with exact artifact names", () => {
    const targets =
      "aarch64-apple-darwin,x86_64-apple-darwin,x86_64-pc-windows-msvc,aarch64-pc-windows-msvc,x86_64-unknown-linux-gnu"
    const table = releaseDownloads(
      "Nothing-129",
      "maxcode",
      "v1.2.3-rc.1",
      targets
    )
    for (const name of desktopAssets(targets, "1.2.3-rc.1").filter(
      (name: string) => /\.(dmg|exe)$/.test(name)
    )) {
      expect(table).toContain(
        `https://github.com/Nothing-129/maxcode/releases/download/v1.2.3-rc.1/${name}`
      )
    }
    expect(table).toContain("| 系统 | 下载 |")
    expect(table).toContain("Apple Silicon")
    expect(table).toContain("shields.io")
    expect(table).not.toMatch(
      /Android|Portable|RpmPackage|AppImage|DebPackage|\.zip|Linux/
    )
  })

  it("omits platforms that are not built", () => {
    const table = releaseDownloads(
      "Nothing-129",
      "maxcode",
      "v1.2.3",
      "aarch64-apple-darwin,x86_64-pc-windows-msvc"
    )
    expect(table).toContain("macOS")
    expect(table).toContain("Windows")
    expect(table.match(/img.shields.io/g)).toHaveLength(2)
    expect(table).not.toContain(".zip")
    expect(table).not.toMatch(/Linux|Intel|arm64.exe/)
    expect(releaseDownloads("Nothing-129", "maxcode", "v1.2.3", "")).toBe("")
    expect(
      releaseDownloads(
        "Nothing-129",
        "maxcode",
        "v1.2.3",
        "x86_64-unknown-linux-gnu"
      )
    ).toBe("")
  })
})
