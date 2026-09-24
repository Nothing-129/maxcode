/** Keep the desktop design fixed until appearance customization is released. */
export const APPEARANCE_CUSTOMIZATION_ENABLED: boolean = false

export const FIXED_APPEARANCE_KEY_PATTERN =
  /^codeg-(?:workspace-bg(?:-|$)|zoom-level$|(?:ui|chat|editor|terminal)-font(?:-|$)|(?:editor|terminal)-ligatures$|editor-word-wrap$|custom-(?:theme|css|style)(?:-|$))/

export function isFixedAppearanceKey(key: string): boolean {
  return (
    !APPEARANCE_CUSTOMIZATION_ENABLED && FIXED_APPEARANCE_KEY_PATTERN.test(key)
  )
}
