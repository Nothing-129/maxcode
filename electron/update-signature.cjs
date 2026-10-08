/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("node:child_process")

// Squirrel validates replacements against the installed app's designated
// requirement. An ad-hoc requirement pins its cdhash and cannot accept updates.
function supportsMacUpdates(appPath, inspect = spawnSync) {
  try {
    const result = inspect(
      "/usr/bin/codesign",
      ["--display", "--verbose=4", appPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 }
    )
    if (result.error || result.status !== 0) return false
    const signature = `${result.stdout || ""}\n${result.stderr || ""}`
    return (
      !/Signature=adhoc|\badhoc\b/.test(signature) &&
      /^Authority=Developer ID Application:/m.test(signature) &&
      /^TeamIdentifier=(?!not set\s*$)\S+/m.test(signature)
    )
  } catch {
    return false
  }
}

module.exports = { supportsMacUpdates }
