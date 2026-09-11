import { readFile, writeFile, mkdir } from "node:fs/promises"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const root = new URL("../", import.meta.url)
const associations = JSON.parse(
  await readFile(new URL("config/file-icon-associations.json", root), "utf8")
)
const collection = require("@iconify-json/vscode-icons/icons.json")
const pkg = require("@iconify-json/vscode-icons/package.json")
const selected = new Set([
  "default-file",
  "default-folder",
  ...associations.map((entry) => entry.icon),
])
const directory = new URL("public/file-icons/", root)
await mkdir(directory, { recursive: true })
const manifest = {}
for (const icon of selected) {
  const light = icon.replace("file-type-", "file-type-light-")
  manifest[icon] = { light: collection.icons[light] ? light : icon, dark: icon }
}
for (const name of new Set(
  Object.values(manifest).flatMap(({ light, dark }) => [light, dark])
)) {
  const icon = collection.icons[name]
  if (!icon) throw new Error(`Unknown VSCode icon: ${name}`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${icon.width ?? collection.width}" height="${icon.height ?? collection.height}" viewBox="0 0 ${icon.width ?? collection.width} ${icon.height ?? collection.height}">${icon.body}</svg>\n`
  await writeFile(new URL(`${name}.svg`, directory), svg)
}
await writeFile(
  new URL("src/lib/file-icon-assets.json", root),
  JSON.stringify(manifest, null, 2) + "\n"
)
await writeFile(
  new URL("README.md", directory),
  `# File icons\n\nVendored SVGs from VSCode Icons (https://github.com/vscode-icons/vscode-icons), via @iconify-json/vscode-icons ${pkg.version}. MIT license; see LICENSE.\n\nRegenerate with \`pnpm icons:generate\` after editing \`config/file-icon-associations.json\`. Assets are served locally for offline use.\n`
)
console.log(
  `Generated ${selected.size} file icon families with theme variants.`
)
