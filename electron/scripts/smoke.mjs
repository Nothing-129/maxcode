import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

// Launch the packaged application, including its bundled backend and frontend.
const directory = {
  darwin: process.arch === "x64" ? "mac" : `mac-${process.arch}`,
  win32:
    process.arch === "x64" ? "win-unpacked" : `win-${process.arch}-unpacked`,
  linux:
    process.arch === "x64"
      ? "linux-unpacked"
      : `linux-${process.arch}-unpacked`,
}[process.platform]
const executable = {
  darwin: "maxcode.app/Contents/MacOS/maxcode",
  win32: "maxcode.exe",
  linux: "maxcode",
}[process.platform]
if (!directory || !executable)
  throw new Error("Unsupported smoke test platform")
const path = resolve("electron/dist", directory, executable)
if (!existsSync(path)) throw new Error(`Packaged application missing: ${path}`)
const env = { ...process.env }
// Exercise the PATH supplied by Finder, not the developer terminal.
if (process.platform === "darwin") env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
delete env.ELECTRON_RUN_AS_NODE
// A development override must never hide a missing resource in the package.
delete env.CODEG_ELECTRON_BACKEND_PATH
delete env.CODEG_ELECTRON_STATIC_DIR
const child = spawn(path, ["--smoke-test"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
})
let passed = false
let output = ""
child.stdout.on("data", (data) => {
  process.stdout.write(data)
  output = (output + data.toString()).slice(-8192)
  passed ||= output.includes("[electron smoke] PASS ")
})
child.stderr.pipe(process.stderr)
const timer = setTimeout(() => {
  console.error("Packaged Electron smoke test timed out")
  if (process.platform === "win32") {
    spawn(
      join(process.env.SystemRoot || "C:\\Windows", "System32/taskkill.exe"),
      ["/pid", String(child.pid), "/T", "/F"]
    )
  } else {
    child.kill("SIGKILL")
  }
  process.exitCode = 1
}, 120000)
child.on("error", (error) => {
  clearTimeout(timer)
  console.error(error.message)
  process.exitCode = 1
})
child.on("close", (code) => {
  clearTimeout(timer)
  if (code !== 0 || !passed) process.exitCode = 1
})
