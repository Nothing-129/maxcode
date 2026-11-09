"use client"

import { ListTodo } from "lucide-react"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useTabActions } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useTranslations } from "next-intl"
import { isNativeDesktop } from "@/lib/platform"
import {
  DesktopChromeIcon,
  desktopChromeButtonClassName,
} from "./desktop-chrome-icon"
import { Button } from "@/components/ui/button"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useIsMac } from "@/hooks/use-is-mac"
import { usePlatform } from "@/hooks/use-platform"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { useZoomLevel } from "@/hooks/use-appearance"
import { formatShortcutLabel } from "@/lib/keyboard-shortcuts"
import { MAC_TRAFFIC_LIGHT_INSET, leftChromeReserve } from "@/lib/window-chrome"

/** Navigation belongs to the conversation column; only a collapsed sidebar
 * requires clearance for the native macOS traffic lights. */
export function LeftEdgeChrome() {
  const tTitleBar = useTranslations("Folder.folderTitleBar")
  const { isOpen, toggle } = useSidebarContext()
  const { activeFolder } = useActiveFolder()
  const { openNewConversationTab, openChatModeTab } = useTabActions()
  const { openConversations, routeId, setRoute } = useWorkbenchRoute()
  const tCard = useTranslations("Folder.conversationCard")
  const tNavigation = useTranslations("Folder.sidebar.navigation")
  const isMac = useIsMac()
  const { shortcuts } = useShortcutSettings()
  const { isMac: platformIsMac } = usePlatform()
  const { zoomLevel } = useZoomLevel()
  // The traffic lights only exist on the macOS desktop runtime (not web / not
  // Windows-Linux), so only reserve their inset there.
  const showMacInset = !isOpen && platformIsMac && isNativeDesktop()

  if (routeId === "automations" || routeId === "tokenUsage") return null

  return (
    <div
      className="flex h-full items-center"
      style={{
        width: isOpen ? "3.5rem" : leftChromeReserve(showMacInset, zoomLevel),
      }}
    >
      {showMacInset && (
        <div
          data-drag-region
          className="h-full shrink-0"
          style={{ width: MAC_TRAFFIC_LIGHT_INSET }}
        />
      )}
      {/* Keep navigation discoverable for mouse, touch, and keyboard users. */}
      <div className="flex items-center gap-2 px-3 text-foreground">
        {!isOpen && (
          <Button
            variant="ghost"
            size="icon"
            // Ghost's own hover is `bg-muted` — identical to the strip, so it
            // reads as no hover at all. Darken past it (and lighten in dark mode)
            // so the hover is actually visible.
            className={desktopChromeButtonClassName}
            aria-label={tTitleBar(isOpen ? "hideSidebar" : "showSidebar")}
            onClick={toggle}
            title={tTitleBar("withShortcut", {
              label: tTitleBar(isOpen ? "hideSidebar" : "showSidebar"),
              shortcut: formatShortcutLabel(shortcuts.toggle_sidebar, isMac),
            })}
          >
            <DesktopChromeIcon name="sidebar" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={desktopChromeButtonClassName}
          onClick={() => {
            if (routeId === "taskConversation") {
              setRoute("tasks")
              return
            }
            openConversations()
            if (activeFolder)
              openNewConversationTab(activeFolder.id, activeFolder.path)
            else openChatModeTab()
          }}
          title={
            routeId === "taskConversation"
              ? tNavigation("todoBoard")
              : tCard("newConversation")
          }
          aria-label={
            routeId === "taskConversation"
              ? tNavigation("todoBoard")
              : tCard("newConversation")
          }
        >
          {routeId === "taskConversation" ? (
            <ListTodo className="size-4" />
          ) : (
            <DesktopChromeIcon name="compose" />
          )}
        </Button>
      </div>
      {/* Empty tail is a window-drag region. */}
      <div data-drag-region className="h-full min-w-0 flex-1" />
    </div>
  )
}
