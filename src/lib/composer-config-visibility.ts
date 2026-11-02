import type { SessionConfigOptionInfo } from "@/lib/types"

export function secondaryComposerConfig(option: SessionConfigOptionInfo) {
  if (option.id === "collaboration_mode") return "collaboration" as const
  if (["fast-mode", "fast_mode"].includes(option.id)) return "fast" as const
  return null
}

export function showComposerConfigInline(option: SessionConfigOptionInfo) {
  const secondary = secondaryComposerConfig(option)
  if (!secondary) return true
  const value = option.kind.current_value
  if (secondary === "collaboration")
    return value !== "default" && value !== "plan"
  return false
}

// Narrow composers share the inline settings, with Fast inside the model pane.
// Keep a standalone Fast entry when an agent does not offer a model picker.
export function showComposerConfigInSettings(
  option: SessionConfigOptionInfo,
  hasModelOption: boolean
) {
  if (secondaryComposerConfig(option) === "fast") return !hasModelOption
  return showComposerConfigInline(option)
}
