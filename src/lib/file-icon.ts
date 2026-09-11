import associations from "../../config/file-icon-associations.json"
import assets from "./file-icon-assets.json"

export type FileIconName = keyof typeof assets

const names = new Map<string, FileIconName>()
const extensions = new Map<string, FileIconName>()
for (const entry of associations) {
  const icon = entry.icon as FileIconName
  for (const name of entry.names) names.set(name.toLowerCase(), icon)
  for (const extension of entry.extensions) extensions.set(extension, icon)
}
// Compound extensions (e.g. .d.ts) take precedence over the final suffix.
const suffixes = [...extensions.keys()].sort((a, b) => b.length - a.length)

export function resolveFileIcon(
  path: string,
  isDirectory = false
): FileIconName {
  if (isDirectory) return "default-folder"
  let decoded = path.split(/[?#]/, 1)[0]
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // A malformed escape must not prevent the rest of the reply rendering.
  }
  const name = (
    decoded
      .replace(/:\d+(?::\d+)?$/, "")
      .split(/[\\/]/)
      .pop() ?? ""
  ).toLowerCase()
  const exact = names.get(name)
  if (exact) return exact
  if (name.startsWith(".env.")) return "file-type-dotenv"
  if (name.startsWith("dockerfile.")) return "file-type-docker"
  const extension = suffixes.find((suffix) => name.endsWith(`.${suffix}`))
  return extension ? extensions.get(extension)! : "default-file"
}

export function fileIconSources(icon: FileIconName) {
  const { light, dark } = assets[icon]
  return {
    light: `/file-icons/${light}.svg`,
    dark: `/file-icons/${dark}.svg`,
  }
}
