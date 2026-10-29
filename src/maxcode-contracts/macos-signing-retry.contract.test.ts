// @vitest-environment node
import { createRequire } from "node:module"
import { describe, expect, it, vi } from "vitest"
import { source } from "./contract-source"

const require = createRequire(import.meta.url)
const { createSigner } = require("../../electron/scripts/mac-sign.cjs")

describe("macOS release signing timestamp recovery", () => {
  it.each([
    "A timestamp was expected but was not found.",
    "The timestamp service is not available.",
    "The timestamp server could not be contacted.",
  ])("retries %s with all signing options preserved", async (message) => {
    const options = {
      app: "/release/MaxCode.app",
      identity: "developer-id",
      keychain: "/temporary/keychain",
      hardenedRuntime: true,
      timestamp: "https://timestamp.example.test",
      optionsForFile: vi.fn(),
    }
    const sign = vi
      .fn()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValue(undefined)
    const wait = vi.fn().mockResolvedValue(undefined)
    const log = vi.fn()
    await createSigner({ sign, wait, log })(options)
    expect(sign).toHaveBeenCalledTimes(2)
    expect(sign.mock.calls.every(([value]) => value === options)).toBe(true)
    expect(wait).toHaveBeenCalledExactlyOnceWith(30_000)
    expect(log.mock.calls.flat().join(" ")).not.toContain(options.keychain)
  })

  it("bounds retries and propagates the final failure", async () => {
    const error = Object.assign(new Error("codesign failed"), {
      stderr: Buffer.from("A timestamp was expected but was not found."),
    })
    const sign = vi.fn().mockRejectedValue(error)
    const wait = vi.fn().mockResolvedValue(undefined)
    await expect(createSigner({ sign, wait, log: vi.fn() })({})).rejects.toBe(
      error
    )
    expect(sign).toHaveBeenCalledTimes(5)
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([
      30_000, 60_000, 120_000, 240_000,
    ])
  })

  it.each([
    "No identity found for signing.",
    "errSecInternalComponent",
    "code object is not signed at all",
    "The timestamp signature is invalid.",
  ])("fails immediately for %s", async (message) => {
    const error = new Error(message)
    const sign = vi.fn().mockRejectedValue(error)
    const wait = vi.fn()
    await expect(createSigner({ sign, wait, log: vi.fn() })({})).rejects.toBe(
      error
    )
    expect(sign).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it("uses the hook only for releases and keeps notarization gates", () => {
    expect(source("electron/electron-builder.cjs")).toContain(
      'sign: release ? require("./scripts/mac-sign.cjs") : undefined'
    )
    const workflow = source(".github/workflows/release.yml")
    expect(workflow).toContain("codesign --verify --deep --strict")
    expect(workflow).toContain("xcrun stapler validate")
    expect(workflow).toContain("spctl --assess")
  })
})
