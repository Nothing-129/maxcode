// @vitest-environment node
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { EventEmitter } from "node:events"
import { runInNewContext } from "node:vm"
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const require = createRequire(import.meta.url)
const runtime = require("../../electron/runtime.cjs")
const packaging = require("../../electron/electron-builder.cjs")
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("MaxCode contract: Electron owns the local desktop", () => {
  it.each([
    { parentOwned: true, shutdownFails: false, expectedCode: 0 },
    { parentOwned: false, shutdownFails: false, expectedCode: 0 },
    { parentOwned: true, shutdownFails: true, expectedCode: 1 },
  ])(
    "always exits smoke mode despite locked Windows profile files: %j",
    async ({ parentOwned, shutdownFails, expectedCode }) => {
      const main = readFileSync(resolve("electron/main.cjs"), "utf8")
      const finishSource = main.slice(
        main.indexOf("async function finishSmoke(code) {"),
        main.indexOf("\nfunction fatalError")
      )
      const shutdown = vi.fn(async () => {
        if (shutdownFails) throw new Error("backend stop failed")
      })
      const rm = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("profile is locked"), { code: "EPERM" })
        )
      const exit = vi.fn()
      const destroy = vi.fn()
      const finish = new Function(
        "shutdown",
        "windows",
        "fs",
        "smokeDir",
        "process",
        "app",
        `${finishSource}; return finishSmoke`
      )(
        shutdown,
        [{ destroy }],
        { promises: { rm } },
        "isolated-smoke-profile",
        {
          env: parentOwned
            ? { CODEG_ELECTRON_SMOKE_DIR: "isolated-smoke-profile" }
            : {},
          stderr: { write: vi.fn() },
        },
        { exit }
      )
      await finish(0)
      expect(shutdown).toHaveBeenCalledOnce()
      expect(exit).toHaveBeenCalledOnce()
      expect(exit).toHaveBeenCalledWith(expectedCode)
      expect(rm).toHaveBeenCalledTimes(parentOwned ? 0 : 1)
      expect(destroy).toHaveBeenCalledTimes(shutdownFails ? 0 : 1)
    }
  )

  it("removes the packaged smoke profile only after the child closes", async () => {
    const script = readFileSync(
      resolve("electron/scripts/smoke.mjs"),
      "utf8"
    ).replace(/^import .*\n/gm, "")
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: { pipe: vi.fn() },
    })
    const rm = vi.fn().mockResolvedValue(undefined)
    const spawn = vi
      .fn<
        (
          file: string,
          args: string[],
          options: { env: Record<string, string> }
        ) => typeof child
      >()
      .mockReturnValue(child)
    const fakeProcess = {
      platform: "win32",
      arch: "x64",
      env: {},
      exitCode: undefined,
      stdout: { write: vi.fn() },
      stderr: {},
    }
    runInNewContext(script, {
      spawn,
      existsSync: () => true,
      mkdtempSync: () => "owned-profile",
      fs: { rm },
      tmpdir: () => "temp",
      join,
      resolve,
      process: fakeProcess,
      console,
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    })
    expect(spawn.mock.calls[0][2].env.CODEG_ELECTRON_SMOKE_DIR).toBe(
      "owned-profile"
    )
    child.stdout.emit("data", Buffer.from("[electron smoke] PASS {}\n"))
    expect(rm).not.toHaveBeenCalled()
    child.emit("close", 0)
    await vi.waitFor(() => expect(rm).toHaveBeenCalledOnce())
    expect(rm).toHaveBeenCalledWith("owned-profile", {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
    expect(fakeProcess.exitCode).toBeUndefined()
  })

  it.skipIf(process.platform === "win32")(
    "restores a GUI launch PATH and runs an env-node agent entrypoint",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "maxcode-gui-path-"))
      directories.push(directory)
      const shell = join(directory, "login-shell")
      const agent = join(directory, "agent")
      const nodeDir = join(directory, "node-bin")
      mkdirSync(nodeDir)
      symlinkSync(process.execPath, join(nodeDir, "node"))
      writeFileSync(
        shell,
        `#!/bin/sh\nprintf 'shell startup banner\nMAXCODE_DESKTOP_PATH=%s:/usr/bin:/bin\n' '${nodeDir}'\n`
      )
      chmodSync(shell, 0o755)
      writeFileSync(
        agent,
        "#!/usr/bin/env node\nprocess.stdout.write('agent-ready')\n"
      )
      chmodSync(agent, 0o755)
      const guiEnv = { ...process.env, SHELL: shell, PATH: "/usr/bin:/bin" }
      expect(() =>
        execFileSync(agent, { env: guiEnv, stdio: "pipe" })
      ).toThrow()
      const env = await runtime.desktopEnvironment(guiEnv, "darwin")
      expect(execFileSync(agent, { env, encoding: "utf8" })).toBe("agent-ready")
      expect(env.PATH.split(":")[0]).toBe(nodeDir)
      expect(env.PATH).not.toContain("shell startup banner")
    }
  )

  it("keeps official Node install paths when the login shell fails", async () => {
    const env = await runtime.desktopEnvironment(
      {
        SHELL: "/nonexistent/maxcode-shell",
        PATH: "/usr/bin:/bin",
        KEEP: "yes",
      },
      "darwin"
    )
    expect(env.PATH.split(":")).toContain("/usr/local/bin")
    expect(env.PATH.split(":")).toContain("/opt/homebrew/bin")
    expect(env.KEEP).toBe("yes")
  })

  it("only trusts the exact backend origin and safe external URL schemes", () => {
    const origin = "http://127.0.0.1:43210"
    expect(runtime.isTrustedUrl(`${origin}/workspace`, origin)).toBe(true)
    for (const url of [
      "http://127.0.0.1:43211/workspace",
      "http://127.0.0.1:43210.evil.test/workspace",
      "http://user:pass@127.0.0.1:43210/workspace",
      "https://127.0.0.1:43210/workspace",
      "file:///workspace",
      "about:blank",
    ]) {
      expect(runtime.isTrustedUrl(url, origin)).toBe(false)
    }
    expect(runtime.externalUrl("https://github.com/Nothing-129/maxcode")).toBe(
      "https://github.com/Nothing-129/maxcode"
    )
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "custom:run",
    ]) {
      expect(() => runtime.externalUrl(url)).toThrow()
    }
  })

  it("gives native privileges to app routes without trusting generated HTML on the same backend", () => {
    const origin = "http://127.0.0.1:43210"
    for (const route of [
      "/",
      "/workspace",
      "/settings/system",
      "/commit?folderId=1",
    ]) {
      expect(runtime.isTrustedAppUrl(`${origin}${route}`, origin)).toBe(true)
    }
    for (const route of [
      "/api/preview/payload.html",
      "/settings/payload.html",
      "/share",
      "/workspace/payload.html",
    ]) {
      expect(runtime.isTrustedAppUrl(`${origin}${route}`, origin)).toBe(false)
    }
  })

  it("keeps preferences across changing ports without persisting the launch token", () => {
    expect(
      runtime.sanitizeStorage(
        { theme: "dark", codeg_token: "old", draft: "secret", zoom: "1.2" },
        "secret"
      )
    ).toEqual({ theme: "dark", zoom: "1.2" })
    expect(() =>
      runtime.sanitizeStorage({ huge: "x".repeat(6 * 1024 * 1024) })
    ).toThrow()
  })

  it.skipIf(process.platform === "win32")(
    "uses the legacy desktop data directory rather than Electron's Linux config directory",
    () => {
      const app = {
        getPath: (name: string) => (name === "home" ? "/home/user" : "/config"),
      }
      expect(runtime.legacyDataDir(app, {}, "linux")).toBe(
        "/home/user/.local/share/app.codeg"
      )
      expect(
        runtime.legacyDataDir(app, { XDG_DATA_HOME: "/data" }, "linux")
      ).toBe("/data/app.codeg")
      expect(
        runtime.legacyDataDir(app, { CODEG_DATA_DIR: "/custom" }, "linux")
      ).toBe("/custom")
      expect(
        runtime.legacyDataDir(app, { CODEG_HOME: "/assets" }, "linux")
      ).toBe("/home/user/.local/share/app.codeg")
    }
  )

  it("packages executable backend siblings outside ASAR and never publishes during a local build", () => {
    expect(packaging.asar).toBe(true)
    expect(packaging.files).not.toContain("!node_modules/**/*")
    expect(packaging.directories.app).toBe(resolve("electron"))
    expect(packaging.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "out", to: "web" }),
        expect.objectContaining({
          from: "electron/.staging/backend",
          to: "backend",
        }),
      ])
    )
    expect(packaging.publish).toEqual([
      {
        provider: "github",
        owner: "Nothing-129",
        repo: "maxcode",
        channel: expect.stringMatching(/^latest-(x64|arm64)$/),
      },
    ])
    expect(packaging.mac.extendInfo.NSLocalNetworkUsageDescription).toContain(
      "local update mirror"
    )
    expect(readFileSync("electron/scripts/cli.mjs", "utf8")).toContain(
      '"never"'
    )
    expect(packaging.mac.binaries).toEqual([
      "Contents/Resources/backend/codeg-server",
      "Contents/Resources/backend/codeg-mcp",
    ])
    expect(packaging.artifactName).toBe(
      "MaxCode-${version}-${os}-${arch}.${ext}"
    )
    const manifest = JSON.parse(readFileSync("package.json", "utf8"))
    const appManifest = JSON.parse(
      readFileSync("electron/package.json", "utf8")
    )
    expect(appManifest.version).toBe(manifest.version)
    expect(appManifest.dependencies["electron-updater"]).toBe("6.8.9")
    expect(manifest.scripts["desktop:dev"]).toBe(
      "node electron/scripts/cli.mjs dev"
    )
    expect(manifest.scripts["desktop:build"]).toBe(
      "node electron/scripts/cli.mjs build"
    )
  })

  it("preserves native account credentials without compiling the Tauri shell", () => {
    const build = readFileSync("electron/scripts/cli.mjs", "utf8")
    expect(build).toContain('"--no-default-features"')
    expect(build).toContain('"native-keyring"')
    const manifest = readFileSync("src-tauri/Cargo.toml", "utf8")
    expect(manifest).toContain('native-keyring = ["dep:keyring"]')
    const keyring = readFileSync("src-tauri/src/keyring_store.rs", "utf8")
    expect(keyring).toContain('#[cfg(feature = "native-keyring")]')
    expect(keyring).not.toContain('feature = "tauri-runtime"')
  })

  it.skipIf(process.platform === "win32")(
    "starts an authenticated private backend and removes it on stop",
    async () => {
      const directory = mkdtempSync(
        join(tmpdir(), "maxcode-electron-contract-")
      )
      directories.push(directory)
      const executable = join(directory, "backend")
      writeFileSync(join(directory, "index.html"), "<html></html>")
      writeFileSync(
        executable,
        `#!${process.execPath}
const fs = require('node:fs')
const http = require('node:http')
const server = http.createServer((request, response) => {
  response.writeHead(request.headers.authorization === 'Bearer ' + process.env.CODEG_TOKEN ? 200 : 401)
  response.end('{}')
})
server.listen(0, process.env.CODEG_HOST, () => {
  fs.writeFileSync(process.env.CODEG_ELECTRON_READY_FILE, JSON.stringify({port: server.address().port}))
})
process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.stdin.resume()
process.stdin.on('end', () => server.close(() => process.exit(0)))
`
      )
      chmodSync(executable, 0o755)
      const backend = await runtime.startBackend({
        executable,
        staticDir: directory,
        dataDir: directory,
      })
      try {
        expect(backend.backendUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
        expect((await fetch(`${backend.backendUrl}/api/health`)).status).toBe(
          401
        )
        expect(
          (
            await fetch(`${backend.backendUrl}/api/health`, {
              headers: { Authorization: `Bearer ${backend.token}` },
            })
          ).status
        ).toBe(200)
      } finally {
        await backend.stop()
      }
      await expect(fetch(`${backend.backendUrl}/api/health`)).rejects.toThrow()
      await backend.stop()
    },
    15000
  )
})
