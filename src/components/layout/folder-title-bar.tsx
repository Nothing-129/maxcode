"use client"

import { useCallback } from "react"
import {
  Menu,
  Ellipsis,
  PanelRight,
  Search,
  Settings,
  SquarePen,
  SquareTerminal,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { openSettingsWindow } from "@/lib/api"
import { isDesktop } from "@/lib/platform"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useCollapseSidebarOnNavigate } from "@/hooks/use-collapse-sidebar-on-navigate"
import { useIsActiveChatMode } from "@/hooks/use-is-active-chat-mode"
import { usePlatform } from "@/hooks/use-platform"
import { Button } from "@/components/ui/button"
import { useSearchDialog } from "@/contexts/search-dialog-context"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useTerminalContext } from "@/contexts/terminal-context"
import { useTabActions } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { WorkbenchRouteChromeActions } from "@/components/workbench/workbench-content"
import { MAC_TRAFFIC_LIGHT_INSET } from "@/lib/window-chrome"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MobileHeaderTarget } from "./mobile-header-slot"
import {
  MobileFrontendRefresh,
  MobileFrontendRefreshItem,
} from "./mobile-frontend-refresh"
import { WindowControls } from "./window-controls"

/** Mobile navigation shares one canvas-colored row with the active title. */
export function FolderTitleBar() {
  const tTitleBar = useTranslations("Folder.folderTitleBar")
  const tCard = useTranslations("Folder.conversationCard")
  const { isOpen: sidebarOpen, toggle } = useSidebarContext()
  const { toggle: toggleAuxPanel } = useAuxPanelContext()
  const { toggle: toggleTerminal } = useTerminalContext()
  const { setOpen: setSearchOpen } = useSearchDialog()
  const { activeFolder } = useActiveFolder()
  const isChatMode = useIsActiveChatMode()
  const { openNewConversationTab, openChatModeTab } = useTabActions()
  const collapseSidebarOnNavigate = useCollapseSidebarOnNavigate()
  const { isConversations, openConversations } = useWorkbenchRoute()
  const { isMac } = usePlatform()
  const showMacInset = isMac && isDesktop()

  const handleOpenSettings = useCallback(() => {
    openSettingsWindow().catch((err) => {
      console.error("[FolderTitleBar] failed to open settings:", err)
    })
  }, [])

  // Mirror the sidebar's "New chat": return to the conversation workspace, then
  // start a new conversation in the active folder — or folderless chat mode when
  // there's none, so this entry point is never a dead end. On touch the sidebar
  // collapses first so the fresh conversation is visible (the sidebar's own
  // "new chat" rows do the same).
  const handleNewConversation = useCallback(() => {
    collapseSidebarOnNavigate()
    openConversations()
    if (!activeFolder) {
      openChatModeTab()
      return
    }
    openNewConversationTab(activeFolder.id, activeFolder.path)
  }, [
    activeFolder,
    collapseSidebarOnNavigate,
    openChatModeTab,
    openNewConversationTab,
    openConversations,
  ])

  return (
    <header
      data-mobile-workspace-header=""
      className="flex h-14 shrink-0 items-center gap-0.5 bg-background px-2 text-foreground select-none"
    >
      {showMacInset && (
        <div
          data-tauri-drag-region
          className="h-full shrink-0"
          style={{ width: MAC_TRAFFIC_LIGHT_INSET }}
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-8 shrink-0 rounded-xl"
        onClick={toggle}
        aria-label={tTitleBar(sidebarOpen ? "hideSidebar" : "showSidebar")}
      >
        <Menu className="size-5" strokeWidth={1.8} />
      </Button>
      <MobileHeaderTarget hidden={!isConversations} />
      {!isConversations && <div className="min-w-0 flex-1" />}
      <WorkbenchRouteChromeActions
        buttonClassName="size-11 shrink-0 rounded-xl"
        iconClassName="size-5"
      />
      <MobileFrontendRefresh />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-8 shrink-0 rounded-xl"
            aria-label={tTitleBar("workspaceTools")}
          >
            <Ellipsis className="size-[18px]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem
            className="min-h-11"
            onSelect={handleNewConversation}
          >
            <SquarePen />
            {tCard("newConversation")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-11"
            onSelect={() => setSearchOpen(true)}
          >
            <Search />
            {tTitleBar("search")}
          </DropdownMenuItem>
          {isConversations && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => toggleTerminal()}
                disabled={!activeFolder}
              >
                <SquareTerminal />
                {tTitleBar("toggleTerminal")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11"
                onSelect={toggleAuxPanel}
                disabled={!activeFolder && !isChatMode}
              >
                <PanelRight />
                {tTitleBar("toggleAuxPanel")}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11" onSelect={handleOpenSettings}>
            <Settings />
            {tTitleBar("openSettings")}
          </DropdownMenuItem>
          <MobileFrontendRefreshItem />
        </DropdownMenuContent>
      </DropdownMenu>
      <WindowControls />
    </header>
  )
}
