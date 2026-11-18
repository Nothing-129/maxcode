import { FolderClosed, House, ListTodo } from "lucide-react"
import type { SVGProps } from "react"
import type { NavigationId } from "@/contexts/sidebar-navigation-context"

const railOutlineIcons = {
  home: House,
  projects: FolderClosed,
  tasks: ListTodo,
}

export function SidebarRailIcon({
  name,
  selected,
}: {
  name: NavigationId
  selected: boolean
}) {
  if (name !== "conversations" && name !== "automations") {
    const Icon = railOutlineIcons[name]
    return (
      <Icon
        aria-hidden="true"
        className="size-[1.125rem]"
        strokeWidth={selected ? 1.9 : 1.7}
      />
    )
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="size-5"
      viewBox="0 0 24 24"
      fill={selected ? "currentColor" : "none"}
      stroke={selected ? "none" : "currentColor"}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "conversations" ? (
        <>
          <path
            d={
              selected
                ? "m9.65 5.08.2-.7a3 3 0 0 1 3.7-2.07l6.26 1.76a3 3 0 0 1 2.08 3.7l-1.77 6.27a3 3 0 0 1-2.1 2.07l-.65-6.16a4.7 4.7 0 0 0-5.16-4.18l-2.72.29Z"
                : "m8.85 7 .76-2.72a3 3 0 0 1 3.7-2.08l6.25 1.76a3 3 0 0 1 2.08 3.7l-1.76 6.25a3 3 0 0 1-3.7 2.08"
            }
          />
          <rect
            x="2.75"
            y="7.2"
            width="13.35"
            height="14.1"
            rx="3"
            transform="rotate(-6 9.425 14.25)"
          />
        </>
      ) : selected ? (
        <path
          fillRule="evenodd"
          d="M12 2.3a9.7 9.7 0 1 0 0 19.4 9.7 9.7 0 0 0 0-19.4Zm0 3.75a.85.85 0 0 1 .85.85v5.45l-2.93 2.93a.85.85 0 1 1-1.2-1.2l2.43-2.43V6.9c0-.47.38-.85.85-.85Z"
        />
      ) : (
        <>
          <circle cx="12" cy="12" r="8.85" />
          <path d="M12 6.9V12l-2.68 2.68" />
        </>
      )}
    </svg>
  )
}

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
