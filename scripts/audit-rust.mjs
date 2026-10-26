import { execFileSync, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
// SQLx records its optional MySQL/RSA dependencies in Cargo.lock even though
// MaxCode only builds SQLite. RUSTSEC-2023-0071 has no patched RSA release.
// Permit that lockfile-only advisory ONLY while RSA is absent from every
// platform's normal/build/dev graph with every feature enabled.
const tree = execFileSync(
  "cargo",
  [
    "tree",
    "--locked",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--target",
    "all",
    "--all-features",
    "--edges",
    "normal,build,dev",
    "--prefix",
    "none",
    "--format",
    "{p}",
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
)
if (/^rsa v/m.test(tree)) {
  throw new Error(
    "RSA is now reachable: remove the RUSTSEC-2023-0071 exception and review its timing-side-channel risk"
  )
}
console.log(
  "RSA advisory exception verified: optional SQLx/MySQL dependency is not compiled on any target."
)
const result = spawnSync(
  "cargo",
  [
    "audit",
    "--file",
    "src-tauri/Cargo.lock",
    "--deny",
    "unsound",
    "--ignore",
    "RUSTSEC-2023-0071",
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: "inherit" }
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
