import { isElectron } from "../electron"

export type TransportEnvironment = "tauri" | "electron" | "web"

export function detectEnvironment(): TransportEnvironment {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return "tauri"
  }
  if (isElectron()) return "electron"
  return "web"
}
