import { FolderClosed, House, ListTodo, MessagesSquare } from "lucide-react"
import type { SVGProps } from "react"
import type { NavigationId } from "@/contexts/sidebar-navigation-context"

const railOutlineIcons = {
  home: House,
  projects: FolderClosed,
  tasks: ListTodo,
  conversations: MessagesSquare,
}

const railSolidPaths: Partial<Record<NavigationId, string>> = {
  home: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM10 12a1 1 0 0 0-1 1v8h6v-8a1 1 0 0 0-1-1Z",
  projects:
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2ZM4.875 9.125a.875.875 0 0 0 0 1.75h14.25a.875.875 0 0 0 0-1.75Z",
  tasks:
    "M4 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM13 3.75h8a1.25 1.25 0 0 1 0 2.5h-8a1.25 1.25 0 0 1 0-2.5ZM13 10.75h8a1.25 1.25 0 0 1 0 2.5h-8a1.25 1.25 0 0 1 0-2.5ZM13 17.75h8a1.25 1.25 0 0 1 0 2.5h-8a1.25 1.25 0 0 1 0-2.5ZM9.884 14.116a1.25 1.25 0 0 1 0 1.768l-4 4a1.25 1.25 0 0 1-1.768 0l-2-2a1.25 1.25 0 0 1 1.768-1.768L5 17.232l3.116-3.116a1.25 1.25 0 0 1 1.768 0Z",
  automations:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 5.125c-.483 0-.875.392-.875.875v5.638l-2.744 2.743a.875.875 0 0 0 1.238 1.238l3-3A.875.875 0 0 0 12.875 12V6A.875.875 0 0 0 12 5.125Z",
}

export function SidebarRailIcon({
  name,
  selected,
}: {
  name: NavigationId
  selected: boolean
}) {
  if (!selected && name !== "automations") {
    const Icon = railOutlineIcons[name]
    return <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="size-5"
      viewBox="0 0 24 24"
      fill={selected ? "currentColor" : "none"}
      stroke={selected ? "none" : "currentColor"}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {selected && railSolidPaths[name] ? (
        <path fillRule="evenodd" d={railSolidPaths[name]} />
      ) : name === "conversations" ? (
        <>
          <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          <path d="M17.75 9H20a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-3.25h6A3.75 3.75 0 0 0 17.75 10V9Z" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l-3 3" />
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
