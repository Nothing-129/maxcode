import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
// Next evaluates its config in multiple workers. Give every worker the same ID.
const buildId = randomUUID()
const result = spawnSync(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "build", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, MAXCODE_FRONTEND_BUILD_ID: buildId },
  }
)
if (result.error) console.error(result.error)
if (result.status !== 0) process.exit(result.status ?? 1)
const exported = JSON.parse(readFileSync("out/frontend-version.json", "utf8"))
const nextBuildId = readFileSync(".next/BUILD_ID", "utf8").trim()
if (exported.buildId !== buildId || nextBuildId !== buildId) {
  throw new Error("Frontend version metadata does not match the built UI")
}
