// @vitest-environment node
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "yaml"
import { describe, expect, it } from "vitest"
import { source, sourceExists } from "./contract-source"

const require = createRequire(import.meta.url)
const {
  targets,
  desktopAssets,
  desktopUpdateAssets,
  validateAssets,
  verifyHost,
} = require("../../electron/scripts/release.cjs")
const mac = "aarch64-apple-darwin"
const windows = "x86_64-pc-windows-msvc"
const linux = "x86_64-unknown-linux-gnu"
const version = "0.30.6"
const asset = (name: string) => ({ name, size: 42 })
const installers = (value: string) => [
  ...desktopUpdateAssets(value, version).map(asset),
  ...desktopAssets(value, version).flatMap((name: string) => [
    asset(name),
    asset(`${name}.sha256`),
  ]),
]

describe("MaxCode contract: Electron release and retired shell isolation", () => {
  it.skipIf(process.platform === "win32").each([
    {
      name: "retries a transient Apple lookup failure",
      failures: 1,
      code: 68,
      signature: 0,
      attempts: 2,
      status: 0,
    },
    {
      name: "fails after three unsuccessful Apple lookups",
      failures: 9,
      code: 68,
      signature: 0,
      attempts: 3,
      status: 68,
    },
    {
      name: "fails immediately for other validation errors",
      failures: 1,
      code: 65,
      signature: 0,
      attempts: 1,
      status: 65,
    },
    {
      name: "never retries an invalid application signature",
      failures: 0,
      code: 68,
      signature: 65,
      attempts: 0,
      status: 65,
    },
  ])("$name", ({ failures, code, signature, attempts, status }) => {
    const workflow = parse(source(".github/workflows/release.yml"))
    const step = workflow.jobs["build-electron"].steps.find(
      (entry: { name?: string }) =>
        entry.name === "Verify signed and notarized macOS application"
    )
    const directory = mkdtempSync(join(tmpdir(), "maxcode-notarization-"))
    try {
      const bin = join(directory, "bin")
      const counter = join(directory, "attempts")
      const assessment = join(directory, "assessed")
      mkdirSync(bin)
      mkdirSync(join(directory, "electron/dist/mac/maxcode.app"), {
        recursive: true,
      })
      writeFileSync(counter, "0\n")
      const command = (name: string, body: string) =>
        writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, {
          mode: 0o755,
        })
      command("codesign", 'exit "$TEST_SIGNATURE_STATUS"')
      command(
        "xcrun",
        `read -r count < "$TEST_COUNTER"
count=$((count + 1))
echo "$count" > "$TEST_COUNTER"
if [ "$count" -le "$TEST_FAILURES" ]; then exit "$TEST_FAILURE_CODE"; fi`
      )
      command("sleep", "exit 0")
      command("spctl", 'touch "$TEST_ASSESSMENT"')
      const result = spawnSync("bash", ["-c", step.run], {
        cwd: directory,
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_COUNTER: counter,
          TEST_ASSESSMENT: assessment,
          TEST_FAILURES: String(failures),
          TEST_FAILURE_CODE: String(code),
          TEST_SIGNATURE_STATUS: String(signature),
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(status)
      expect(Number(readFileSync(counter, "utf8"))).toBe(attempts)
      expect(existsSync(assessment)).toBe(status === 0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("uses runtime-neutral release job names and upload patterns", () => {
    const workflow = parse(source(".github/workflows/release.yml"))
    const desktop = workflow.jobs["build-electron"]
    expect(desktop.name).toBe("MaxCode ${{ matrix.name }}")
    const upload = desktop.steps.find((step: { run?: string }) =>
      step.run?.startsWith("gh release upload")
    )
    expect(upload.run).toContain("electron/dist/MaxCode-*")
    expect(upload.run).not.toContain("MaxCode-Electron-")
  })

  it("does not cache an absent pnpm store in the draft metadata job", () => {
    const workflow = parse(source(".github/workflows/release.yml"))
    const setup = workflow.jobs["create-draft-release"].steps.find(
      (step: { uses?: string }) => step.uses?.startsWith("actions/setup-node@")
    )
    expect(setup).toBeDefined()
    expect(setup.with.cache).toBeUndefined()
  })

  it("resolves native desktop runners, deduplicates targets and rejects unsupported targets", () => {
    expect(targets(` ${mac},${mac}, `, true)).toHaveLength(1)
    expect(targets("x86_64-apple-darwin", true)[0].runner).toBe(
      "macos-15-intel"
    )
    expect(targets("aarch64-pc-windows-msvc", true)[0].runner).toBe(
      "windows-11-arm"
    )
    expect(() => targets("unknown", true)).toThrow("Unsupported")
    expect(() => targets("aarch64-unknown-linux-gnu", true)).toThrow(
      "Unsupported desktop"
    )
    expect(targets("aarch64-unknown-linux-gnu")[0].artifact).toBe(
      "MaxCode-server-linux-arm64"
    )
    expect(() => targets("aarch64-pc-windows-msvc")).toThrow(
      "Unsupported server"
    )
  })

  it("rejects mixed Node and Rust architectures before packaging", () => {
    expect(() => verifyHost(mac, "darwin", "arm64", mac)).not.toThrow()
    expect(() => verifyHost(mac, "darwin", "x64", mac)).toThrow(
      "does not match"
    )
    expect(() =>
      verifyHost(mac, "darwin", "arm64", "x86_64-apple-darwin")
    ).toThrow("does not match")
  })

  it("requires both macOS packages and format-specific Linux architecture names", () => {
    expect(desktopAssets(mac, version)).toEqual([
      `MaxCode-${version}-mac-arm64.dmg`,
      `MaxCode-${version}-mac-arm64.zip`,
    ])
    expect(desktopAssets(linux, version)).toEqual([
      `MaxCode-${version}-linux-x86_64.AppImage`,
      `MaxCode-${version}-linux-amd64.deb`,
    ])
    expect(desktopAssets(windows, version)).toEqual([
      `MaxCode-${version}-win-x64.exe`,
    ])
  })

  it("blocks missing, empty or wrong-version installers and missing checksums", () => {
    const assets = installers(`${mac},${windows}`)
    expect(() =>
      validateAssets(assets, `${mac},${windows}`, "", version)
    ).not.toThrow()
    expect(() =>
      validateAssets(assets.slice(1), `${mac},${windows}`, "", version)
    ).toThrow("Missing release assets")
    expect(() =>
      validateAssets(assets.slice(0, -1), `${mac},${windows}`, "", version)
    ).toThrow("Missing release assets")
    expect(() =>
      validateAssets(
        assets.map((value: { name: string }) => ({ ...value, size: 0 })),
        mac,
        "",
        version
      )
    ).toThrow("Missing release assets")
    expect(() => validateAssets(assets, mac, "", "0.30.7")).toThrow(
      "Missing release assets"
    )
    expect(() => validateAssets([], "", "", version)).toThrow(
      "No release targets"
    )
  })

  it("retains server signature requirements and supports server-only releases", () => {
    const bundle = "MaxCode-server-linux-x64.tar.gz"
    const server = [bundle, `${bundle}.sig`, `${bundle}.sha256`].map(asset)
    expect(() => validateAssets(server, "", linux, version)).not.toThrow()
    expect(() =>
      validateAssets(
        [asset(bundle), asset(`${bundle}.sha256`)],
        "",
        linux,
        version
      )
    ).toThrow("Missing release assets")
    expect(() =>
      validateAssets([...installers(mac), ...server], mac, linux, version)
    ).not.toThrow()
  })

  it("refuses a stale Tauri updater feed on an Electron release", () => {
    expect(() =>
      validateAssets(
        [...installers(mac), asset("latest.json")],
        mac,
        "",
        version
      )
    ).toThrow("Legacy Tauri")
  })

  it("publishes only on the personal repository after builds and packaged smoke checks succeed", () => {
    const workflow = source(".github/workflows/release.yml")
    expect(workflow).toContain("github.repository == 'Nothing-129/maxcode'")
    expect(workflow).toContain("needs.build-electron.result == 'success'")
    expect(workflow).toContain("pnpm desktop:smoke")
    expect(workflow).toContain("release.cjs validate-assets")
    expect(workflow).toContain("pnpm server:sign")
    expect(workflow).not.toContain("tauri-apps/tauri-action")
    expect(workflow).not.toContain("build-tauri:")
    expect(workflow).toContain(
      "APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_PASSWORD }}"
    )
    expect(workflow).toContain("xcrun stapler validate")
    const ci = source(".github/workflows/test.yml")
    expect(ci).toContain("native-keyring,test-utils --all-targets")
    expect(ci).toContain(
      "--no-default-features --features test-utils --all-targets"
    )
    expect(source("src-tauri/tests/credential_helper_subprocess.rs")).toContain(
      '#![cfg(all(unix, not(feature = "native-keyring")))]'
    )
    expect(ci).toContain("pnpm desktop:pack")
    expect(ci).toContain("pnpm desktop:smoke")
    expect(ci).not.toContain("libwebkit2gtk")
    expect(sourceExists(".github/workflows/legacy-tauri.yml")).toBe(false)
  })
})
