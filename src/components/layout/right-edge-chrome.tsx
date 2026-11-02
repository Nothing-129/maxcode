"use client"

import { useTranslations } from "next-intl"
import {
  DesktopChromeIcon,
  desktopChromeButtonClassName,
} from "./desktop-chrome-icon"
import { Button } from "@/components/ui/button"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { WorkbenchRouteChromeActions } from "@/components/workbench/workbench-content"
import { useIsActiveChatMode } from "@/hooks/use-is-active-chat-mode"
import { useIsMac } from "@/hooks/use-is-mac"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { formatShortcutLabel } from "@/lib/keyboard-shortcuts"

/** Only visible controls receive pointer input. The sibling conversation menu
 * sits immediately to the left and must remain clickable. */
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
  const isMac = useIsMac()
  const { shortcuts } = useShortcutSettings()

  return (
    <div className="pointer-events-none flex h-full items-center">
      {/* Keep navigation discoverable for mouse, touch, and keyboard users. */}
      <div className="flex items-center gap-2 px-3 text-foreground [&_button]:pointer-events-auto">
        {isConversations && (
          <>
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
      </div>
    </div>
  )
}
