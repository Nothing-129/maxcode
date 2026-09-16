import { isElectron } from "../electron"

export type TransportEnvironment = "electron" | "web"

export function detectEnvironment(): TransportEnvironment {
  return isElectron() ? "electron" : "web"
}
