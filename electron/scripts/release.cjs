/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require("node:crypto")
const { execFileSync } = require("node:child_process")
const {
  appendFileSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require("node:fs")
const { join } = require("node:path")
const { gunzipSync } = require("node:zlib")
const { updateManifestName } = require("../update-config.cjs")

// Native runners keep Electron and both Rust binaries on the same architecture.
const platforms = {
  "x86_64-apple-darwin": ["macOS x64", "macos-15-intel", "mac", "x64"],
  "aarch64-apple-darwin": ["macOS arm64", "macos-15", "mac", "arm64"],
  "x86_64-unknown-linux-gnu": ["Linux x64", "ubuntu-22.04", "linux", "x64"],
  "aarch64-unknown-linux-gnu": [
    "Linux arm64",
    "ubuntu-22.04",
    "linux",
    "arm64",
  ],
  "x86_64-pc-windows-msvc": ["Windows x64", "windows-2022", "win", "x64"],
  "aarch64-pc-windows-msvc": [
    "Windows arm64",
    "windows-11-arm",
    "win",
    "arm64",
  ],
}

function targets(value = "", desktop = false) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ].map((target) => {
    const platform = platforms[target]
    if (!platform || (desktop && target === "aarch64-unknown-linux-gnu")) {
      throw new Error(
        `Unsupported ${desktop ? "desktop" : "server"} target: ${target}`
      )
    }
    const [name, runner, os, arch] = platform
    if (!desktop && os === "win" && arch === "arm64") {
      throw new Error(`Unsupported server target: ${target}`)
    }
    const serverOs = { mac: "darwin", win: "windows", linux: "linux" }[os]
    return {
      name,
      runner,
      target,
      os,
      arch,
      artifact: `MaxCode-server-${serverOs}-${arch}`,
    }
  })
}

function desktopAssets(value, version) {
  return targets(value, true).flatMap(({ os, arch }) => {
    const extensions = {
      mac: ["dmg", "zip"],
      win: ["exe"],
      linux: ["AppImage", "deb"],
    }[os]
    return extensions.map((ext) => {
      const artifactArch =
        arch === "x64"
          ? { deb: "amd64", AppImage: "x86_64" }[ext] || arch
          : arch
      return `MaxCode-Electron-${version}-${os}-${artifactArch}.${ext}`
    })
  })
}

function validateAssets(assets, desktop, server, version) {
  const expected = [
    ...desktopAssets(desktop, version).flatMap((name) => [
      name,
      `${name}.sha256`,
    ]),
    ...desktopUpdateAssets(desktop, version),
    ...targets(server).flatMap(({ os, artifact }) => {
      const name = `${artifact}.${os === "win" ? "zip" : "tar.gz"}`
      return [name, `${name}.sig`, `${name}.sha256`]
    }),
  ]
  if (!expected.length) throw new Error("No release targets selected")
  const missing = expected.filter(
    (name) => !assets.some((asset) => asset.name === name && asset.size > 0)
  )
  if (missing.length)
    throw new Error(`Missing release assets: ${missing.join(", ")}`)
  if (assets.some(({ name }) => name === "latest.json")) {
    throw new Error(
      "Legacy Tauri latest.json must not accompany an Electron release"
    )
  }
  return expected
}

function desktopUpdateAssets(value, version) {
  return [
    ...targets(value, true).map(({ os, arch }) => updateManifestName(os, arch)),
    ...desktopAssets(value, version)
      .filter((name) => /\.(zip|exe)$/.test(name))
      .map((name) => `${name}.blockmap`),
  ]
}

function validateUpdateFiles(directory, target, version) {
  const { parse } = require("yaml")
  const entries = targets(target, true)
  for (const { os, arch, target: triple } of entries) {
    const manifest = parse(
      readFileSync(join(directory, updateManifestName(os, arch)), "utf8")
    )
    const expected = desktopAssets(triple, version)
    if (manifest.version !== version || !Array.isArray(manifest.files))
      throw new Error("Invalid desktop update manifest version or files")
    if (manifest.path && !expected.includes(manifest.path))
      throw new Error("Unexpected legacy update path")
    for (const name of expected) {
      const entry = manifest.files.find((file) => file.url === name)
      const file = readFileSync(join(directory, name))
      if (
        !entry ||
        entry.size !== file.length ||
        entry.sha512 !== createHash("sha512").update(file).digest("base64")
      ) {
        throw new Error(`Update manifest does not match installer: ${name}`)
      }
    }
    if (manifest.files.some((file) => !expected.includes(file.url)))
      throw new Error("Unexpected file in desktop update manifest")
  }
  for (const name of desktopUpdateAssets(target, version).filter((name) =>
    name.endsWith(".blockmap")
  )) {
    const map = JSON.parse(
      gunzipSync(readFileSync(join(directory, name))).toString()
    )
    if (
      map.version !== "2" ||
      !map.files?.length ||
      map.files.some(
        (file) =>
          !file.sizes?.length || file.sizes.length !== file.checksums?.length
      )
    ) {
      throw new Error(`Invalid differential blockmap: ${name}`)
    }
  }
}

function verifyHost(
  target,
  platform = process.platform,
  arch = process.arch,
  rustHost
) {
  const [entry] = targets(target, true)
  const os = { darwin: "mac", win32: "win", linux: "linux" }[platform]
  if (!entry || entry.os !== os || entry.arch !== arch || rustHost !== target) {
    throw new Error(
      `Desktop target ${target} does not match Node ${platform}/${arch} and Rust ${rustHost}`
    )
  }
}

module.exports = {
  targets,
  desktopAssets,
  desktopUpdateAssets,
  validateAssets,
  validateUpdateFiles,
  verifyHost,
}

if (require.main === module) {
  try {
    const desktop = process.env.DESKTOP_TARGETS || ""
    const server = process.env.SERVER_TARGETS || ""
    const { version } = require("../../package.json")
    switch (process.argv[2]) {
      case "matrix": {
        const output = {
          desktop_matrix: JSON.stringify({ include: targets(desktop, true) }),
          server_matrix: JSON.stringify({ include: targets(server) }),
          docker: [
            "x86_64-unknown-linux-gnu",
            "aarch64-unknown-linux-gnu",
          ].every((target) =>
            targets(server).some((entry) => entry.target === target)
          ),
        }
        if (!targets(desktop, true).length && !targets(server).length) {
          throw new Error("No release targets selected")
        }
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          Object.entries(output)
            .map(([key, value]) => `${key}=${value}\n`)
            .join("")
        )
        break
      }
      case "verify-host": {
        const rust = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
        verifyHost(
          process.argv[3],
          process.platform,
          process.arch,
          rust.match(/^host: (.+)$/m)?.[1]
        )
        break
      }
      case "checksum":
        validateUpdateFiles("electron/dist", process.argv[3], version)
        for (const name of desktopAssets(process.argv[3], version)) {
          const file = join("electron/dist", name)
          if (!statSync(file).isFile() || !statSync(file).size)
            throw new Error(`Empty installer: ${file}`)
          const hash = createHash("sha256")
            .update(readFileSync(file))
            .digest("hex")
          writeFileSync(`${file}.sha256`, `${hash}  ${name}\n`)
        }
        break
      case "validate-assets":
        validateAssets(
          JSON.parse(readFileSync(0, "utf8")).assets,
          desktop,
          server,
          version
        )
        break
      default:
        throw new Error(`Unknown release command: ${process.argv[2]}`)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
