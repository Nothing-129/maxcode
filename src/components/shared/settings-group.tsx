import type { ReactNode } from "react"

/** A section heading above a quiet, bordered settings surface. */
export function SettingsGroup({
  heading,
  children,
}: {
  heading: ReactNode
  children: ReactNode
}) {
  return (
    <section data-settings-group="" className="space-y-3">
      <div data-settings-group-heading="">{heading}</div>
      <div data-settings-group-body="" className="space-y-4">
        {children}
      </div>
    </section>
  )
}
