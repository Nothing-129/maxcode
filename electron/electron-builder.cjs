/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path")
const fs = require("node:fs")
const { version } = require("../package.json")

module.exports = {
  appId: "app.codeg.electron",
  productName: "MaxCode",
  executableName: "maxcode",
  extraMetadata: { version },
  directories: {
    app: __dirname,
    output: path.join(__dirname, "dist"),
    buildResources: path.join(__dirname, "../src-tauri/icons"),
  },
  files: [
    "*.cjs",
    "package.json",
    "!electron-builder.cjs",
    "!node_modules/**/*",
  ],
  extraResources: [
    { from: "out", to: "web", filter: ["**/*"] },
    { from: "electron/.staging/backend", to: "backend", filter: ["**/*"] },
  ],
  asar: true,
  npmRebuild: false,
  artifactName: "MaxCode-Electron-${version}-${os}-${arch}.${ext}",
  publish: null,
  beforePack: () => {
    const root = path.resolve(__dirname, "..")
    for (const input of [
      "out/index.html",
      ...["codeg-server", "codeg-mcp"].map(
        (name) =>
          `electron/.staging/backend/${name}${process.platform === "win32" ? ".exe" : ""}`
      ),
    ]) {
      if (
        !fs.existsSync(path.join(root, input)) ||
        fs.statSync(path.join(root, input)).size === 0
      ) {
        throw new Error(`Missing build input ${input}; run pnpm electron:build`)
      }
    }
  },
  mac: {
    identity: process.env.CSC_NAME || (process.env.CSC_LINK ? undefined : "-"),
    category: "public.app-category.developer-tools",
    icon: "src-tauri/icons/icon.icns",
    target: ["dmg", "zip"],
    hardenedRuntime: true,
  },
  win: { icon: "src-tauri/icons/icon.ico", target: ["nsis"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  linux: {
    icon: "src-tauri/icons/128x128.png",
    category: "Development",
    target: ["AppImage", "deb"],
    maintainer: "MaxCode contributors",
  },
}
