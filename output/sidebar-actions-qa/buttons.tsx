import { type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { SidebarNavigationIcon } from "@/components/layout/sidebar-navigation-icon"
export function SidebarNavButton({
  icon,
  label,
  onClick,
  active,
  trailing,
}: {
  icon: "compose" | "clock" | "tasks"
  label: string
  onClick: () => void
  active?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Equal-width buttons keep the three actions on a single compact row.
        "group relative flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-sidebar-accent/35 px-0.5",
        "text-[0.875rem] leading-5 text-sidebar-foreground outline-none",
        "transition-colors duration-150 hover:bg-sidebar-accent",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active && "bg-sidebar-primary/10"
      )}
    >
      <SidebarNavigationIcon
        name={icon}
        className="size-3.5 shrink-0 text-sidebar-foreground/75"
      />
      <span className="truncate">{label}</span>
      {trailing}
    </button>
  )
}
