/* eslint-disable @typescript-eslint/no-require-imports */
const { createRequire } = require("node:module")
const { setTimeout: delay } = require("node:timers/promises")

function defaultSign(options) {
  // Use the same signer/version as electron-builder, including pnpm layouts.
  const builder = createRequire(require.resolve("electron-builder"))
  const appBuilder = createRequire(builder.resolve("app-builder-lib"))
  return appBuilder("@electron/osx-sign").signAsync(options)
}

function createSigner({
  sign = defaultSign,
  wait = delay,
  log = console.warn,
} = {}) {
  return async (options) => {
    const delays = [30_000, 60_000, 120_000, 240_000]
    for (let attempt = 0; ; attempt++) {
      try {
        return await sign(options)
      } catch (error) {
        const diagnostic = [error?.message, error?.stderr].join("\n")
        const timestampFailure =
          /A timestamp was expected but was not found|The timestamp service is not available|The timestamp server could not be contacted/i.test(
            diagnostic
          )
        if (!timestampFailure || attempt === delays.length) throw error
        log(
          `[mac-sign] Timestamp service failed; retry ${attempt + 1}/${delays.length} in ${delays[attempt] / 1000}s`
        )
        await wait(delays[attempt])
      }
    }
  }
}

module.exports = createSigner()
module.exports.createSigner = createSigner
