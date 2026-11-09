"use client"

import {
  ChartNoAxesColumn,
  Clock3,
  FolderClosed,
  House,
  ListTodo,
  MessagesSquare,
  Settings,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useSidebarNavigation } from "@/contexts/sidebar-navigation-context"
import { useSidebarContext } from "@/contexts/sidebar-context"
import {
  isTaskWorkspaceRoute,
  useWorkbenchRoute,
} from "@/contexts/workbench-route-context"
import { useAutomationsView } from "@/contexts/automations-view-context"
import { openSettingsWindow } from "@/lib/api"
import { SidebarCodexQuota } from "./sidebar-codex-quota"
import { StatusBarAlerts } from "./status-bar-alerts"
import { useAppUpdate } from "@/components/providers/update-provider"
import { SettingsAbout } from "@/components/settings/settings-about"
import { isNativeDesktop } from "@/lib/platform"
import { cn } from "@/lib/utils"

const ITEMS = [
  { id: "home", icon: House },
  { id: "conversations", icon: MessagesSquare },
  { id: "projects", icon: FolderClosed },
  { id: "tasks", icon: ListTodo },
  { id: "automations", icon: Clock3 },
] as const

export function WorkspaceNavigationRail({
  mobile = false,
}: { mobile?: boolean } = {}) {
  const t = useTranslations("Folder.sidebar.navigation")
  const navigation = useSidebarNavigation()
  const update = useAppUpdate()
  const { routeId, setRoute } = useWorkbenchRoute()
  const { isOpen, toggle, close } = useSidebarContext()
  const { unseenFailures } = useAutomationsView()
  if (!navigation) return null

  const active = isTaskWorkspaceRoute(routeId)
    ? "tasks"
    : routeId === "conversations"
      ? navigation.view
      : routeId

  return (
    <nav
      aria-label={t("label")}
      data-workspace-navigation
      data-mobile-navigation={mobile || undefined}
      className="flex h-full min-h-0 w-14 shrink-0 flex-col items-center border-r border-sidebar-border/40 bg-sidebar/80 px-1.5 pb-3 text-sidebar-foreground"
    >
      {!mobile && isNativeDesktop() ? (
        <div data-drag-region className="h-14 w-full shrink-0" />
      ) : (
        <div aria-hidden="true" className="h-2 w-full shrink-0" />
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {ITEMS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={t(id)}
            aria-label={t(id)}
            aria-current={active === id ? "page" : undefined}
            onClick={() => {
              if (id === "automations" || id === "tasks") {
                if (id === "tasks" && !isOpen) toggle()
                setRoute(id)
                if (mobile && id === "automations") close()
              } else {
                navigation.setView(id)
                setRoute("conversations")
                if (!isOpen) toggle()
              }
            }}
            className={cn(
              "relative flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              active === id &&
                "bg-sidebar-foreground/[0.06] text-sidebar-foreground"
            )}
          >
            <Icon
              className="size-[1.125rem]"
              strokeWidth={active === id ? 1.9 : 1.7}
            />
            {id === "automations" && unseenFailures > 0 && (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" />
            )}
          </button>
        ))}
      </div>
      <div
        data-navigation-utilities
        className="mt-2 flex shrink-0 flex-col items-center gap-1"
      >
        <SidebarCodexQuota compact />
        <button
          type="button"
          aria-label={t("statistics")}
          title={t("statistics")}
          aria-current={routeId === "tokenUsage" ? "page" : undefined}
          onClick={() => {
            setRoute("tokenUsage")
            if (mobile) close()
          }}
          className={cn(
            "relative flex size-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            routeId === "tokenUsage" &&
              "bg-sidebar-foreground/[0.06] text-sidebar-foreground"
          )}
        >
          <ChartNoAxesColumn
            className="size-[1.125rem]"
            strokeWidth={routeId === "tokenUsage" ? 1.9 : 1.7}
          />
        </button>
        <SettingsAbout compact />
        <button
          type="button"
          title={[t("settings"), update?.currentVersion]
            .filter(Boolean)
            .join(" · ")}
          aria-label={t("settings")}
          onClick={() => {
            if (mobile) close()
            void openSettingsWindow().catch(console.error)
          }}
          className="relative flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings className="size-[1.125rem]" strokeWidth={1.7} />
        </button>
        <StatusBarAlerts compact />
      </div>
    </nav>
  )
}
