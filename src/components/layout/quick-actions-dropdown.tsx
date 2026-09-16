"use client"

import { useCallback, useState } from "react"
import {
  FolderGit2,
  FolderOpenDot,
  GamepadDirectional,
  LayoutTemplate,
  Map as MapIcon,
  Rocket,
  Zap,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAutomationsView } from "@/contexts/automations-view-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { openProjectBootWindow } from "@/lib/api"
import { CloneDialog } from "./clone-dialog"
import { WorkspaceFolderDialog } from "./workspace-folder-dialog"

/**
 * The quick-actions launcher pinned to the status bar's leading edge — the
 * window's bottom-left corner.
 *
 * Every entry here already exists somewhere else (the sidebar's nav rows, the
 * folder-list context menu, the top-left chrome, Settings › Appearance), but
 * those homes are scattered and several of them disappear with the sidebar
 * collapsed. The status bar never unmounts, so this menu is the one always-on
 * path to all of them. Items are grouped by what they act on rather than by
 * where they used to live: workspace (open/clone/boot), navigation
 * (every full-page workbench route). Search and the
 * per-folder session actions (manage / import) are the deliberate omissions —
 * search has a permanent button in the window's top-left chrome, and the
 * session actions are folder-scoped, so they live where a folder is: "Manage
 * conversations" in the folder row's context menu, "Import local sessions"
 * there and on the Folders section header. Both go away with the sidebar, but
 * a copy here could only ever act on whatever folder happened to be active,
 * which is not what a folder-scoped action means.
 *
 * Dialogs are rendered as siblings of the menu, not inside it: the menu
 * unmounts its content on close, which would take a nested dialog with it.
 */
export function QuickActionsDropdown() {
  const t = useTranslations("Folder.statusBar.quickActions")
  const tFolderDropdown = useTranslations("Folder.folderNameDropdown")
  const tSidebar = useTranslations("Folder.sidebar")

  const { unseenFailures } = useAutomationsView()
  const { setRoute } = useWorkbenchRoute()

  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const handleProjectBoot = useCallback(() => {
    openProjectBootWindow().catch((err) => {
      console.error("[QuickActionsDropdown] failed to open project boot:", err)
    })
  }, [])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 hover:text-foreground/80"
            title={t("title")}
            aria-label={t("title")}
          >
            {/* Sized with `size-3.5`, NOT `h-3.5 w-3.5`: the Button base
                carries `[&_svg:not([class*='size-'])]:size-4`, and that
                selector's (0,2,1) specificity beats a bare `h-*`/`w-*`
                (0,1,0) — so the `h-3.5 w-3.5` spelling silently rendered this
                glyph at 1rem, the largest icon on a bar whose others are
                0.75–0.875rem. Spelling it `size-` is what opts out of that
                rule. 0.875rem is also exactly the sidebar's nav-icon size, so
                atop the bar's `pl-2` this glyph shares their leading edge, not
                just their rail axis. */}
            <GamepadDirectional aria-hidden="true" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        {/* `side="top"`: the trigger sits on the window's bottom edge, so the
            menu has to grow upward. `w-auto` releases the shared content
            width-matches-trigger rule — the trigger is a 1.5rem icon. */}
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-auto min-w-60"
        >
          <DropdownMenuLabel>{t("groups.workspace")}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setFolderDialogOpen(true)}>
            <FolderOpenDot />
            {tFolderDropdown("openFolder")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCloneOpen(true)}>
            <FolderGit2 />
            {tFolderDropdown("cloneRepository")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleProjectBoot}>
            <Rocket />
            {tFolderDropdown("projectBoot")}
          </DropdownMenuItem>
          {/* No Search row: it now has a permanent button in the window's
              top-left chrome (`LeftEdgeChrome`, and `FolderTitleBar` on mobile),
              which is visible without opening anything. This menu exists for
              actions whose only other home disappears with the sidebar. */}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("groups.navigation")}</DropdownMenuLabel>
          {/* Every full-page workbench route the sidebar lists, in the sidebar's
              own order. The badged rows carry the same badges as their sidebar
              twins: failures are destructive-tinted, tasks waiting on the user
              are not. None of them mark the current route the way the sidebar
              rows do — this is a launcher, not a nav list, and every other row
              in it is stateless, so a tinted row here reads as hover/focus
              rather than "you are here". */}
          <DropdownMenuItem onSelect={() => setRoute("automations")}>
            <Zap />
            <span className="min-w-0 flex-1 truncate">
              {tSidebar("automations")}
            </span>
            {unseenFailures > 0 && (
              <span className="inline-flex h-[0.9375rem] min-w-[0.9375rem] shrink-0 items-center justify-center rounded-full bg-destructive/15 px-1 font-mono text-[0.625rem] font-medium leading-none text-destructive">
                {unseenFailures}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRoute("forge")}>
            <LayoutTemplate />
            {tSidebar("forge")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRoute("canvas")}>
            <MapIcon />
            {tSidebar("canvas")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkspaceFolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
      />
      <CloneDialog open={cloneOpen} onOpenChange={setCloneOpen} />
    </>
  )
}
