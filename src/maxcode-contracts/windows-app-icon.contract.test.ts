import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

import { repoPath, source } from "./contract-source"

const require = createRequire(import.meta.url)
const sharp = createRequire(require.resolve("next/package.json"))("sharp")

describe("MaxCode contract: Windows desktop icon", () => {
  it("ships transparent artwork at desktop and taskbar scaling sizes", async () => {
    const ico = readFileSync(repoPath("src-tauri/icons/icon.ico"))
    expect(ico.readUInt16LE(2)).toBe(1)
    const sizes = new Set<number>()
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const entry = 6 + i * 16
      const size = ico[entry] || 256
      sizes.add(size)
      const offset = ico.readUInt32LE(entry + 12)
      const length = ico.readUInt32LE(entry + 8)
      const { data, info } = await sharp(ico.subarray(offset, offset + length))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect(info.width).toBe(size)
      expect(info.height).toBe(size)
      // Blue/dark desktop backgrounds must show through all four corners.
      for (const pixel of [0, size - 1, size * (size - 1), size * size - 1]) {
        expect(data[pixel * 4 + 3]).toBe(0)
      }
      // The white rounded plate must remain visible, with a dark terminal face.
      const pixelAt = (x: number, y: number) =>
        (Math.floor(y * size) * size + Math.floor(x * size)) * 4
      expect(data[pixelAt(0.5, 0.12)]).toBeGreaterThan(220)
      expect(data[pixelAt(0.5, 0.45)]).toBeLessThan(130)
      expect(data[pixelAt(0.5, 0.45) + 3]).toBe(255)
    }
    for (const size of [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]) {
      expect(sizes.has(size)).toBe(true)
    }
  })

  it("uses the branded ICO for the Windows executable", () => {
    expect(source("electron/electron-builder.cjs")).toContain(
      'win: { icon: "src-tauri/icons/icon.ico"'
    )
  })
})
