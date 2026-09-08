#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(join(root, "package.json"))
const [command = "dev", ...args] = process.argv.slice(2)

function run(binary, argv, options = {}) {
  const result = spawnSync(binary, argv, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function buildFrontend() {
  // pnpm supplies its real JS entry point, including through Corepack on
  // Windows. Avoid shell commands and their platform-specific quoting.
  const pnpmEntry = process.env.npm_execpath
  if (!pnpmEntry) {
    throw new Error("Run this script via pnpm electron:dev / electron:build")
  }
  run(process.execPath, [pnpmEntry, "run", "build"], {
    env: { ...process.env, ASSET_PREFIX: "" },
  })
}

function buildBackend(release) {
  run(
    "cargo",
    [
      "build",
      "--no-default-features",
      "--features",
      "native-keyring",
      "--bin",
      "codeg-server",
      "--bin",
      "codeg-mcp",
      ...(release ? ["--release"] : []),
    ],
    { cwd: join(root, "src-tauri") }
  )
  if (!release) return
  const destination = join(root, "electron/.staging/backend")
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const name of ["codeg-server", "codeg-mcp"]) {
    const filename = `${name}${process.platform === "win32" ? ".exe" : ""}`
    const targetDir = process.env.CARGO_TARGET_DIR
      ? resolve(root, "src-tauri", process.env.CARGO_TARGET_DIR)
      : join(root, "src-tauri/target")
    const output = join(destination, filename)
    copyFileSync(join(targetDir, "release", filename), output)
    if (process.platform !== "win32") chmodSync(output, 0o755)
  }
}

function launch() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  if (env.CARGO_TARGET_DIR && !env.CODEG_ELECTRON_BACKEND_PATH) {
    env.CODEG_ELECTRON_BACKEND_PATH = resolve(
      root,
      "src-tauri",
      env.CARGO_TARGET_DIR,
      "debug",
      process.platform === "win32" ? "codeg-server.exe" : "codeg-server"
    )
  }
  run(require("electron"), [join(root, "electron"), ...args], { env })
}

function packagingEnvironment() {
  // electron-builder invokes `pnpm list` itself. Corepack can run this
  // project's scripts even when no global pnpm shim exists, so provide a
  // build-local launcher for that same pnpm entry point on every platform.
  const entry = process.env.npm_execpath
  if (!entry) throw new Error("Run packaging through pnpm electron:build")
  const bin = join(root, "electron/.staging/tools")
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, "pnpm"),
    `#!/usr/bin/env node
const args = process.argv.slice(2)
// pnpm 11 lists the workspace by default; package only the Electron app.
if (args[0] === "list") args.unshift("--filter", "maxcode-desktop")
const result = require("node:child_process").spawnSync(process.execPath, [${JSON.stringify(entry)}, ...args], { stdio: "inherit" })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
`,
    { mode: 0o755 }
  )
  writeFileSync(join(bin, "pnpm.cmd"), '@node "%~dp0pnpm" %*\r\n')
  const env = { ...process.env }
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH"
  env[pathKey] = `${bin}${delimiter}${env[pathKey] || ""}`
  return env
}

try {
  switch (command) {
    case "dev":
      buildFrontend()
      buildBackend(false)
      launch()
      break
    case "start":
      launch()
      break
    case "build":
    case "pack":
      if (
        args.length > 0 &&
        !(
          process.platform === "darwin" &&
          command === "build" &&
          args.join(" ") === "--mac dmg"
        )
      ) {
        throw new Error(
          "Electron packages must be built on the target OS/architecture; only --mac dmg is supported as an override"
        )
      }
      if (process.env.CARGO_BUILD_TARGET) {
        throw new Error(
          "Unset CARGO_BUILD_TARGET to build the backend for this Electron host"
        )
      }
      buildFrontend()
      buildBackend(true)
      run(
        process.execPath,
        [
          require.resolve("electron-builder/cli.js"),
          "--config",
          "electron/electron-builder.cjs",
          "--publish",
          "never",
          ...(command === "pack" ? ["--dir"] : []),
          ...args,
        ],
        { env: packagingEnvironment() }
      )
      break
    default:
      throw new Error(`Unknown Electron command: ${command}`)
  }
} catch (error) {
  console.error(`[electron] ${error.message}`)
  process.exitCode = 1
}
