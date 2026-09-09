"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { openSettingsWindow } from "@/lib/api"
import {
  DesktopChromeIcon,
  desktopChromeButtonClassName,
} from "./desktop-chrome-icon"
import { Button } from "@/components/ui/button"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useTerminalContext } from "@/contexts/terminal-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { WorkbenchRouteChromeActions } from "@/components/workbench/workbench-content"
import { useIsActiveChatMode } from "@/hooks/use-is-active-chat-mode"
import { useIsMac } from "@/hooks/use-is-mac"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { useZoomLevel } from "@/hooks/use-appearance"
import { formatShortcutLabel } from "@/lib/keyboard-shortcuts"
import { rightChromeClusterWidth } from "@/lib/window-chrome"

/**
 * Contents of the window's fixed top-RIGHT chrome overlay: terminal + aux-panel
 * toggles (conversations) or the active route's own page-level controls
 * (full-page routes), then settings. `FolderLayoutShell` pins this at the
 * window's top-right
 * corner (to the LEFT of the Windows/Linux caption buttons) so it never moves —
 * or re-mounts — when the aux panel opens or closes. Preserves the old title
 * bar's disabled predicates and active styling. A leading drag filler right-
 * aligns the cluster and lets its empty space move the window; the fixed width
 * matches the right-edge column's reservation (see `rightChromeReserve`).
 */
export function RightEdgeChrome() {
  const tTitleBar = useTranslations("Folder.folderTitleBar")
  const { activeFolder } = useActiveFolder()
  const isChatMode = useIsActiveChatMode()
  // Full-page workbench routes (tasks / automations) overlay the workspace the
  // terminal and aux panel live in — toggling them there is invisible, so the
  // two buttons hide and the route's own page-level controls take their slots
  // (WorkbenchRouteChromeActions below). The way OUT of such a route is the
  // breadcrumb button at the head of its title (see WorkbenchPageTitle), not
  // this corner.
  const { isConversations } = useWorkbenchRoute()
  const { isOpen: auxPanelOpen, toggle: toggleAuxPanel } = useAuxPanelContext()
  const { isOpen: terminalOpen, toggle: toggleTerminal } = useTerminalContext()
  const isMac = useIsMac()
  const { shortcuts } = useShortcutSettings()
  const { zoomLevel } = useZoomLevel()

  const handleOpenSettings = useCallback(() => {
    openSettingsWindow().catch((err) => {
      console.error("[RightEdgeChrome] failed to open settings:", err)
    })
  }, [])

  return (
    <div
      className="flex h-full items-center"
      style={{ width: rightChromeClusterWidth(zoomLevel) }}
    >
      {/* Empty head is a window-drag region; buttons stay flush right. */}
      <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
      {/* Keep navigation discoverable for mouse, touch, and keyboard users. */}
      <div className="flex items-center gap-1 rounded-full p-2 pr-3 text-muted-foreground">
        {isConversations && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={`${desktopChromeButtonClassName} ${terminalOpen ? "bg-accent" : ""}`}
              onClick={() => toggleTerminal()}
              disabled={!activeFolder}
              title={tTitleBar("withShortcut", {
                label: tTitleBar("toggleTerminal"),
                shortcut: formatShortcutLabel(shortcuts.toggle_terminal, isMac),
              })}
            >
              <DesktopChromeIcon name="terminal" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`${desktopChromeButtonClassName} ${auxPanelOpen ? "bg-accent" : ""}`}
              onClick={toggleAuxPanel}
              disabled={!activeFolder && !isChatMode}
              title={tTitleBar("withShortcut", {
                label: tTitleBar("toggleAuxPanel"),
                shortcut: formatShortcutLabel(
                  shortcuts.toggle_aux_panel,
                  isMac
                ),
              })}
            >
              <DesktopChromeIcon name="panel" />
            </Button>
          </>
        )}
        <WorkbenchRouteChromeActions
          buttonClassName={desktopChromeButtonClassName}
          iconClassName="h-3.5 w-3.5"
        />
        <Button
          variant="ghost"
          size="icon"
          className={desktopChromeButtonClassName}
          onClick={handleOpenSettings}
          title={tTitleBar("withShortcut", {
            label: tTitleBar("openSettings"),
            shortcut: formatShortcutLabel(shortcuts.open_settings, isMac),
          })}
        >
          <DesktopChromeIcon name="settings" />
        </Button>
      </div>
    </div>
  )
}
