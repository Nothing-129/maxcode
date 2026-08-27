"use client"

export interface TeambitionSettings {
  serverId: string
  projectId: string
  projectName: string
}

const STORAGE_KEY = "workspace:teambition-settings"

export const DEFAULT_TEAMBITION_SETTINGS: TeambitionSettings = {
  serverId: "teambition",
  projectId: "67244dbc1b2dbce76a282336",
  projectName: "技术部敏捷项目",
}

function cleanIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const cleaned = value.trim()
  return /^[A-Za-z0-9_-]{1,128}$/.test(cleaned) ? cleaned : fallback
}

export function loadTeambitionSettings(): TeambitionSettings {
  if (typeof window === "undefined") return DEFAULT_TEAMBITION_SETTINGS
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as {
      serverId?: unknown
      projectId?: unknown
      projectName?: unknown
    } | null
    if (!parsed) return DEFAULT_TEAMBITION_SETTINGS
    const projectName =
      typeof parsed.projectName === "string" && parsed.projectName.trim()
        ? parsed.projectName.trim().slice(0, 120)
        : DEFAULT_TEAMBITION_SETTINGS.projectName
    return {
      serverId: cleanIdentifier(
        parsed.serverId,
        DEFAULT_TEAMBITION_SETTINGS.serverId
      ),
      projectId: cleanIdentifier(
        parsed.projectId,
        DEFAULT_TEAMBITION_SETTINGS.projectId
      ),
      projectName,
    }
  } catch {
    return DEFAULT_TEAMBITION_SETTINGS
  }
}

export function saveTeambitionSettings(
  settings: TeambitionSettings
): TeambitionSettings {
  const normalized = {
    serverId: cleanIdentifier(
      settings.serverId,
      DEFAULT_TEAMBITION_SETTINGS.serverId
    ),
    projectId: cleanIdentifier(
      settings.projectId,
      DEFAULT_TEAMBITION_SETTINGS.projectId
    ),
    projectName:
      settings.projectName.trim().slice(0, 120) ||
      DEFAULT_TEAMBITION_SETTINGS.projectName,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}
