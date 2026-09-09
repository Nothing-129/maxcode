export const OPEN_IN_APP_SETTINGS_EVENT = "maxcode:open-settings"
export interface InAppSettingsRequest {
  section?: string
  agentType?: string | null
}

export function requestInAppSettings(detail: InAppSettingsRequest): boolean {
  if (typeof window === "undefined") return false
  const event = new CustomEvent(OPEN_IN_APP_SETTINGS_EVENT, {
    detail,
    cancelable: true,
  })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
