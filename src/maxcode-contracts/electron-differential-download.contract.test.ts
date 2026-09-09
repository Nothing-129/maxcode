// @vitest-environment node
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { gzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const {
  verifyDifferential,
} = require("../../electron/scripts/differential-check.cjs")

describe("MaxCode contract: real differential HTTP transfer", () => {
  it.each(["delta", "missing cache", "broken blockmap", "corrupt cache"])(
    "reconstructs and verifies the installer with %s",
    async (scenario) => {
      const directory = mkdtempSync(join(tmpdir(), "maxcode-blockmap-fixture-"))
      try {
        const blockSize = 64 * 1024
        const before = Buffer.concat(
          Array.from({ length: 32 }, (_, index) =>
            Buffer.alloc(blockSize, index)
          )
        )
        const after = Buffer.from(before)
        after.fill(255, blockSize * 10, blockSize * 11)
        const blockmap = (data: Buffer) =>
          gzipSync(
            JSON.stringify({
              version: "2",
              files: [
                {
                  name: "file",
                  offset: 0,
                  sizes: Array(32).fill(blockSize),
                  checksums: Array.from({ length: 32 }, (_, index) =>
                    createHash("sha256")
                      .update(
                        data.subarray(
                          index * blockSize,
                          (index + 1) * blockSize
                        )
                      )
                      .digest("base64")
                  ),
                },
              ],
            })
          )
        const oldFile = join(directory, "old.zip")
        const newFile = join(directory, "new.zip")
        writeFileSync(oldFile, before)
        writeFileSync(newFile, after)
        writeFileSync(`${oldFile}.blockmap`, blockmap(before))
        writeFileSync(`${newFile}.blockmap`, blockmap(after))
        if (scenario === "corrupt cache")
          writeFileSync(oldFile, Buffer.alloc(before.length, 254))
        const result = await verifyDifferential({
          oldFile,
          newFile,
          oldBlockmap: `${oldFile}.blockmap`,
          newBlockmap: `${newFile}.blockmap`,
          missingCache: scenario === "missing cache",
          brokenBlockmap: scenario === "broken blockmap",
        })
        expect(result.verified).toBe(true)
        expect(result.fallback).toBe(scenario !== "delta")
        if (scenario === "delta") {
          expect(result.rangeBytes).toBe(blockSize)
          expect(result.fullBytes).toBe(0)
        } else expect(result.fullBytes).toBe(after.length)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )
})
