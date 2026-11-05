// @vitest-environment node
import { createRequire } from "node:module"
import { describe, expect, it, vi } from "vitest"
import { source } from "./contract-source"
const require = createRequire(import.meta.url)
const { createNotarizer } = require("../../electron/scripts/mac-notarize.cjs")
const env = {
  CODEG_ELECTRON_RELEASE: "1",
  APPLE_ID: "user",
  APPLE_APP_SPECIFIC_PASSWORD: "secret",
  APPLE_TEAM_ID: "team",
}
const context = {
  electronPlatformName: "darwin",
  appOutDir: "/output with spaces",
  packager: { appInfo: { productFilename: "maxcode" } },
}
const network = () =>
  new Error(
    "Failed to staple your application with code: 68\nNSURLErrorDomain Code=-1005 The network connection was lost."
  )

describe("macOS notarization ticket network recovery", () => {
  it("retries only stapling after accepted notarization and never logs credentials", async () => {
    const notarize = vi.fn().mockRejectedValue(network())
    const staple = vi.fn().mockResolvedValue(undefined)
    const wait = vi.fn()
    const log = vi.fn()
    await createNotarizer({ notarize, staple, wait, log, env })(context)
    expect(notarize).toHaveBeenCalledExactlyOnceWith({
      appPath: "/output with spaces/maxcode.app",
      appleId: "user",
      appleIdPassword: "secret",
      teamId: "team",
    })
    expect(staple).toHaveBeenCalledExactlyOnceWith(
      "/output with spaces/maxcode.app"
    )
    expect(wait).toHaveBeenCalledExactlyOnceWith(30000)
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret")
  })
  it("bounds repeated network failures and propagates the last error", async () => {
    const error = Object.assign(network(), { code: 68 })
    const notarize = vi.fn().mockRejectedValue(network())
    const staple = vi.fn().mockRejectedValue(error)
    const wait = vi.fn()
    await expect(
      createNotarizer({ notarize, staple, wait, log: vi.fn(), env })(context)
    ).rejects.toBe(error)
    expect(notarize).toHaveBeenCalledTimes(1)
    expect(staple).toHaveBeenCalledTimes(4)
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([
      30000, 60000, 120000, 240000,
    ])
  })
  it.each([
    "notarization rejected: invalid signature",
    "Invalid Apple credentials",
    "Failed to staple your application with code: 68\nTicket does not match",
    "NSURLErrorDomain Code=-1005",
  ])("does not recover %s", async (message) => {
    const error = new Error(message)
    const staple = vi.fn()
    await expect(
      createNotarizer({
        notarize: vi.fn().mockRejectedValue(error),
        staple,
        env,
      })(context)
    ).rejects.toBe(error)
    expect(staple).not.toHaveBeenCalled()
  })
  it("fails a permanent error during retry and leaves successful submissions alone", async () => {
    const error = Object.assign(new Error("invalid ticket"), { code: 65 })
    const staple = vi.fn().mockRejectedValue(error)
    await expect(
      createNotarizer({
        notarize: vi.fn().mockRejectedValue(network()),
        staple,
        wait: vi.fn(),
        log: vi.fn(),
        env,
      })(context)
    ).rejects.toBe(error)
    expect(staple).toHaveBeenCalledTimes(1)
    const success = vi.fn().mockResolvedValue(undefined)
    await createNotarizer({ notarize: success, staple, env })(context)
    expect(staple).toHaveBeenCalledTimes(1)
  })
  it("requires release credentials, skips other platforms, and retains verification gates", async () => {
    const notarize = vi.fn()
    await expect(
      createNotarizer({ notarize, env: { CODEG_ELECTRON_RELEASE: "1" } })(
        context
      )
    ).rejects.toThrow("Missing notarization credential")
    await createNotarizer({ notarize, env })({
      ...context,
      electronPlatformName: "win32",
    })
    await createNotarizer({ notarize, env: {} })(context)
    expect(notarize).not.toHaveBeenCalled()
    const config = source("electron/electron-builder.cjs")
    expect(config).toContain(
      'afterSign: release ? require("./scripts/mac-notarize.cjs") : undefined'
    )
    const workflow = source(".github/workflows/release.yml")
    for (const gate of [
      "codesign --verify --deep --strict",
      "xcrun stapler validate",
      "spctl --assess",
    ])
      expect(workflow).toContain(gate)
  })
})
