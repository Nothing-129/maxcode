// @vitest-environment node
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { gzipSync } from "node:zlib"
import { stringify } from "yaml"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const {
  desktopAssets,
  desktopUpdateAssets,
  validateUpdateFiles,
} = require("../../electron/scripts/release.cjs")

describe("MaxCode contract: differential update release metadata", () => {
  it("separates architecture feeds and requires ZIP/NSIS blockmaps", () => {
    expect(
      desktopUpdateAssets(
        "aarch64-apple-darwin,x86_64-apple-darwin,x86_64-pc-windows-msvc",
        "1.2.3"
      )
    ).toEqual(
      expect.arrayContaining([
        "latest-arm64-mac.yml",
        "latest-x64-mac.yml",
        "latest-x64.yml",
        "MaxCode-1.2.3-mac-arm64.zip.blockmap",
        "MaxCode-1.2.3-win-x64.exe.blockmap",
      ])
    )
  })

  it.each([
    "valid",
    "wrong version",
    "wrong hash",
    "wrong size",
    "foreign URL",
    "broken blockmap",
  ])("validates %s before release upload", (scenario) => {
    const directory = mkdtempSync(join(tmpdir(), "maxcode-update-info-"))
    const target = "aarch64-apple-darwin"
    const version = "1.2.3"
    try {
      const bytes = Buffer.from("installer content")
      const names: string[] = desktopAssets(target, version)
      const files = names.map((name) => ({
        url: name,
        size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      }))
      for (const name of names) writeFileSync(join(directory, name), bytes)
      if (scenario === "wrong hash") files[0].sha512 = "untrusted"
      if (scenario === "wrong size") files[0].size++
      if (scenario === "foreign URL")
        files[0].url = "https://example.com/installer.zip"
      writeFileSync(
        join(directory, "latest-arm64-mac.yml"),
        stringify({
          version: scenario === "wrong version" ? "1.2.4" : version,
          files,
        })
      )
      writeFileSync(
        join(
          directory,
          `${names.find((name) => name.endsWith(".zip"))}.blockmap`
        ),
        scenario === "broken blockmap"
          ? Buffer.from("bad")
          : gzipSync(
              JSON.stringify({
                version: "2",
                files: [
                  {
                    name: "file",
                    offset: 0,
                    sizes: [bytes.length],
                    checksums: ["a"],
                  },
                ],
              })
            )
      )
      if (scenario === "valid")
        expect(() =>
          validateUpdateFiles(directory, target, version)
        ).not.toThrow()
      else
        expect(() => validateUpdateFiles(directory, target, version)).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
