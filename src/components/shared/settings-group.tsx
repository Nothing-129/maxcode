import type { ReactNode } from "react"

/** A section heading paired with its related settings. */
export function SettingsGroup({
  heading,
  fullWidth = false,
  children,
}: {
  fullWidth?: boolean
  heading: ReactNode
  children: ReactNode
}) {
  return (
    <section
      data-settings-group={fullWidth ? "full" : ""}
      className="space-y-3"
    >
      <div data-settings-group-heading="">{heading}</div>
      <div data-settings-group-body="" className="space-y-4">
        {children}
      </div>
    </section>
  )
}
