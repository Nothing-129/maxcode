/* eslint-disable @typescript-eslint/no-require-imports */
const { createRequire } = require("node:module")
const { execFile } = require("node:child_process")
const { promisify } = require("node:util")
const { setTimeout: delay } = require("node:timers/promises")
const { join } = require("node:path")
const execute = promisify(execFile)

function defaultNotarize(options) {
  const builder = createRequire(require.resolve("electron-builder"))
  const appBuilder = createRequire(builder.resolve("app-builder-lib"))
  return appBuilder("@electron/notarize").notarize(options)
}

function transientStapleFailure(error) {
  const text = [error?.message, error?.stdout, error?.stderr].join("\n")
  return (
    /Failed to staple your application with code: 68|staple.*failed.*68/i.test(
      text
    ) &&
    /NSURLErrorDomain Code=-(1001|1003|1004|1005|1006|1009)|network connection was lost|timed out|could not connect to the server/i.test(
      text
    )
  )
}

function createNotarizer({
  notarize = defaultNotarize,
  staple = (appPath) => execute("xcrun", ["stapler", "staple", "-v", appPath]),
  wait = delay,
  log = console.warn,
  env = process.env,
} = {}) {
  return async ({ electronPlatformName, appOutDir, packager }) => {
    if (electronPlatformName !== "darwin" || env.CODEG_ELECTRON_RELEASE !== "1")
      return
    for (const key of [
      "APPLE_ID",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ]) {
      if (!env[key]) throw new Error(`Missing notarization credential: ${key}`)
    }
    const appPath = join(appOutDir, `${packager.appInfo.productFilename}.app`)
    try {
      await notarize({
        appPath,
        appleId: env.APPLE_ID,
        appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: env.APPLE_TEAM_ID,
      })
      return
    } catch (error) {
      // A staple failure happens only after Apple accepted notarization.
      // Never resubmit, re-sign or turn a rejected submission into success.
      if (!transientStapleFailure(error)) throw error
      let last = error
      for (const [index, ms] of [30_000, 60_000, 120_000, 240_000].entries()) {
        log(
          `[mac-notarize] Apple ticket network failure; staple retry ${index + 1}/4 in ${ms / 1000}s`
        )
        await wait(ms)
        try {
          await staple(appPath)
          return
        } catch (failure) {
          // execFile uses a numeric exit code, unlike @electron/notarize.
          if (
            failure.code !== 68 ||
            !transientStapleFailure({
              message: `staple failed 68\n${failure.message}`,
              stdout: failure.stdout,
              stderr: failure.stderr,
            })
          )
            throw failure
          last = failure
        }
      }
      throw last
    }
  }
}

module.exports = createNotarizer()
module.exports.createNotarizer = createNotarizer
