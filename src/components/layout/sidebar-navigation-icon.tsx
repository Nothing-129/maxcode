import type { SVGProps } from "react"

/** Sidebar drawings matched to the supplied ChatGPT reference. */
export function SidebarNavigationIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: "compose" | "clock" | "tasks" }) {
  return (
    <svg
      {...props}
      data-sidebar-navigation-icon={name}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "compose" ? (
        <>
          <path d="M9 3.5H6.5a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3V11" />
          <path d="m9 12-2.5.5L7 10l7-7a1.77 1.77 0 0 1 2.5 2.5L9 12Z" />
        </>
      ) : name === "clock" ? (
        <>
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 5.5V10l-2.75 1.75" />
        </>
      ) : (
        <>
          <circle cx="5" cy="5" r="1.25" />
          <path d="M9 5h7M9 10h7M9 15h7M3.5 10l1 1 2-2M3.5 15l1 1 2-2" />
        </>
      )}
    </svg>
  )
}
