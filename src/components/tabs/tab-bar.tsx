"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { WheelEvent as ReactWheelEvent } from "react"
import { Reorder } from "motion/react"
import type { PanInfo } from "motion/react"
import { Folder, SquarePen, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import type { TabItem as TabItemData } from "@/contexts/tab-context"
import { groupOfTab, OTHER_FOLDER_ZONE_ID } from "@/stores/tab-store"
import {
  firstLeafId,
  leafIds,
  type SplitDirection,
} from "@/lib/tab-group-layout"
import {
  clientPointFromDrag,
  dropIndexFromMidpoints,
} from "@/lib/tab-drag-drop"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useCollapseSidebarOnNavigate } from "@/hooks/use-collapse-sidebar-on-navigate"
import { useIsCoarsePointer } from "@/hooks/use-is-coarse-pointer"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { TabItem, type TabMoveTarget } from "./tab-item"

interface TabBarProps {
  /** Split-group strip: render only this group's tabs, highlight the GROUP's
   *  selected tab, and target new tabs/reorders at the group. Omitted = the
   *  single title-bar strip shown while unsplit. */
  groupId?: string
}

// Rendered inside the desktop conversation-column title strip while unsplit,
// or once per group shell (with `groupId`) while split. The old standalone
// mobile variant is gone — mobile shows the conversation detail header instead
// and navigates tabs from the sidebar.
export function TabBar({ groupId }: TabBarProps) {
  const t = useTranslations("Folder.conversationCard")
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const groupOf = useTabStore((s) => s.groupOf)
  const groupLayout = useTabStore((s) => s.groupLayout)
  const groupSelection = useTabStore((s) => s.groupSelection)
  const tileByGroup = useTabStore((s) => s.tileByGroup)
  const groupFolder = useTabStore((s) => s.groupFolder)
  const {
    switchTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    pinTab,
    toggleGroupTile,
    splitTab,
    moveTabToGroup,
    toggleGroupOrientation,
    dissolveGroup,
    closeGroup,
    unsplitAll,
    reorderTabs,
    reorderGroupTabs,
    updateTabDrag,
    endTabDrag,
    openNewConversationTab,
    openChatModeTab,
  } = useTabActions()
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)
  const branches = useAppWorkspaceStore((s) => s.branches)
  const { activeFolder } = useActiveFolder()
  const collapseSidebarOnNavigate = useCollapseSidebarOnNavigate()
  const { openConversations } = useWorkbenchRoute()

  // The group this strip represents (unsplit strip = the single first leaf),
  // its tabs, and its displayed "active" tab: the GROUP's selected tab — for
  // the focused group (and the unsplit strip) that IS the global active tab.
  const stripGroupId = groupId ?? firstLeafId(groupLayout)
  const groupTabs = useMemo(
    () =>
      groupId == null
        ? tabs
        : tabs.filter(
            (tab) => groupOfTab(groupOf, groupLayout, tab.id) === groupId
          ),
    [tabs, groupId, groupOf, groupLayout]
  )
  const displayActiveId =
    groupId == null ? activeTabId : (groupSelection[groupId] ?? null)
  const isTileMode = !!tileByGroup[stripGroupId]
  const boundFolder = allFolders.find(
    (folder) => folder.id === groupFolder[stripGroupId]
  )
  const isOtherZone = groupFolder[stripGroupId] === OTHER_FOLDER_ZONE_ID
  const zoneName = isOtherZone
    ? t("otherFolderZone")
    : (boundFolder?.alias?.trim() ?? "") || boundFolder?.name || null
  const handleToggleTile = useCallback(
    () => toggleGroupTile(stripGroupId),
    [toggleGroupTile, stripGroupId]
  )

  // Split-group context-menu wiring, shared by every tab in this strip.
  const orderedLeaves = useMemo(() => leafIds(groupLayout), [groupLayout])
  const isSplit = orderedLeaves.length > 1
  const canSplitMove = groupTabs.length >= 2
  const moveTargets = useMemo<TabMoveTarget[]>(() => {
    if (!isSplit) return []
    return orderedLeaves
      .map((leafId, index) => ({
        groupId: leafId,
        index: index + 1,
        title:
          tabs.find((tab) => tab.id === groupSelection[leafId])?.title ?? null,
      }))
      .filter((target) => target.groupId !== stripGroupId)
  }, [isSplit, orderedLeaves, tabs, groupSelection, stripGroupId])
  const handleSplit = useCallback(
    (tabId: string, direction: SplitDirection, move: boolean) =>
      splitTab(tabId, direction, { move }),
    [splitTab]
  )
  const handleToggleSplitOrientation = useCallback(
    () => toggleGroupOrientation(stripGroupId),
    [toggleGroupOrientation, stripGroupId]
  )
  const handleUnsplit = useCallback(
    () => dissolveGroup(stripGroupId),
    [dissolveGroup, stripGroupId]
  )

  // ── Cross-group drag & drop (split-group strips only) ────────────────────
  // The dragged tab itself is axis-locked to its own strip (Reorder drag="x" +
  // overflow clipping), so crossing groups is pointer-based: hit-test the
  // element under the cursor for another group's strip or shell, highlight it,
  // and commit the move on release. Same-group hits resolve to null — a drop
  // there is just the ordinary within-strip reorder.
  const isDropTarget = useTabStore(
    (s) => groupId != null && s.tabDrag?.overGroupId === groupId
  )
  const resolveDropTarget = useCallback(
    (
      clientX: number,
      clientY: number
    ): { gid: string; el: Element; strip: boolean } | null => {
      if (groupId == null) return null
      const el = document.elementFromPoint(clientX, clientY)
      if (!el) return null
      const strip = el.closest("[data-conv-group-strip]")
      if (strip) {
        const gid = strip.getAttribute("data-conv-group-strip")
        return gid && gid !== groupId ? { gid, el: strip, strip: true } : null
      }
      const shell = el.closest("[data-conv-group-shell]")
      if (shell) {
        const gid = shell.getAttribute("data-conv-group-shell")
        return gid && gid !== groupId ? { gid, el: shell, strip: false } : null
      }
      return null
    },
    [groupId]
  )
  const handleTabDrag = useCallback(
    (
      tab: TabItemData,
      event: MouseEvent | TouchEvent | PointerEvent,
      info: PanInfo
    ) => {
      const { x, y } = clientPointFromDrag(event, info)
      const target = resolveDropTarget(x, y)
      const compatibleTarget =
        target == null ||
        groupFolder[target.gid] == null ||
        groupFolder[target.gid] === OTHER_FOLDER_ZONE_ID ||
        groupFolder[target.gid] === tab.folderId
          ? target
          : null
      updateTabDrag({
        tabId: tab.id,
        title: tab.title,
        x,
        y,
        overGroupId: compatibleTarget?.gid ?? null,
      })
    },
    [groupFolder, resolveDropTarget, updateTabDrag]
  )
  const handleTabDragEnd = useCallback(
    (
      tab: TabItemData,
      event: MouseEvent | TouchEvent | PointerEvent,
      info: PanInfo
    ) => {
      const { x, y } = clientPointFromDrag(event, info)
      const target = resolveDropTarget(x, y)
      endTabDrag()
      if (!target) return
      if (
        groupFolder[target.gid] != null &&
        groupFolder[target.gid] !== OTHER_FOLDER_ZONE_ID &&
        groupFolder[target.gid] !== tab.folderId
      )
        return
      // Strip drop: land at the cursor position (midpoint count). Shell-body
      // drop: append (the store clamps the oversized index to the tail).
      const index = target.strip
        ? dropIndexFromMidpoints(
            x,
            Array.from(target.el.querySelectorAll("[data-tab-id]")).map(
              (tabEl) => {
                const rect = tabEl.getBoundingClientRect()
                return rect.left + rect.width / 2
              }
            )
          )
        : Number.MAX_SAFE_INTEGER
      moveTabToGroup(tab.id, target.gid, { index })
    },
    [resolveDropTarget, endTabDrag, groupFolder, moveTabToGroup]
  )
  const crossDragEnabled = groupId != null && isSplit

  // New-conversation affordance at the end of the tab strip. Mirrors the
  // sidebar's "New chat": return to the conversation workspace, then open a
  // draft — or a folderless chat when no context resolves, so the button is
  // never a dead end. Group strips seed from the GROUP's own selection (its
  // folder / chat mode) rather than the globally-active folder: each group is
  // its own workspace slice, and the focused group may be a different one.
  const handleNewConversation = useCallback(() => {
    // On touch, get the sidebar out of the way so the fresh draft is visible —
    // same predicate the sidebar's own "new chat" rows collapse under.
    collapseSidebarOnNavigate()
    openConversations()
    const groupOptions = groupId != null ? { targetGroup: groupId } : undefined
    if (groupId != null) {
      const selTab =
        groupTabs.find((tab) => tab.id === displayActiveId) ?? groupTabs[0]
      const selFolder = selTab
        ? allFolders.find((f) => f.id === selTab.folderId)
        : undefined
      if (selTab?.isChat === true || selFolder?.kind === "chat") {
        openChatModeTab(groupOptions)
        return
      }
      if (selTab && selFolder) {
        openNewConversationTab(
          selFolder.id,
          selTab.workingDir ?? selFolder.path,
          groupOptions
        )
        return
      }
      // Group context unresolvable (folder deleted) — fall through to the
      // active-folder default.
    }
    if (!activeFolder) {
      openChatModeTab(groupOptions)
      return
    }
    openNewConversationTab(activeFolder.id, activeFolder.path, groupOptions)
  }, [
    activeFolder,
    allFolders,
    collapseSidebarOnNavigate,
    displayActiveId,
    groupId,
    groupTabs,
    openChatModeTab,
    openConversations,
    openNewConversationTab,
  ])

  const folderIndex = useMemo(() => {
    const map = new Map<number, { name: string }>()
    for (const f of allFolders) map.set(f.id, { name: f.name })
    return map
  }, [allFolders])

  const scrollRef = useRef<HTMLDivElement>(null)
  const isCoarsePointer = useIsCoarsePointer()
  const [touchSortingTabId, setTouchSortingTabId] = useState<string | null>(
    null
  )

  useEffect(() => {
    if (!displayActiveId || !scrollRef.current) return
    const el = scrollRef.current.querySelector(
      `[data-tab-id="${displayActiveId}"]`
    )
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [displayActiveId])

  // A regular mouse wheel has no horizontal axis, so turn its vertical ticks
  // into horizontal tab-strip movement when the strip overflows. Trackpads keep
  // their native horizontal delta. Without this, hiding the native scrollbar
  // would make older tabs reachable only through keyboard tab switching.
  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (el.scrollWidth <= el.clientWidth) return
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
    el.scrollLeft += event.deltaY
    event.preventDefault()
  }, [])

  const handleReorder = useCallback(
    (nextTabs: TabItemData[]) => {
      if (isCoarsePointer && !touchSortingTabId) return
      if (groupId == null) {
        reorderTabs(nextTabs)
      } else {
        reorderGroupTabs(groupId, nextTabs)
      }
    },
    [groupId, isCoarsePointer, reorderGroupTabs, reorderTabs, touchSortingTabId]
  )

  const handleTouchSortingEnd = useCallback(
    () => setTouchSortingTabId(null),
    [setTouchSortingTabId]
  )

  if (groupTabs.length === 0) return null

  const activeIndex = groupTabs.findIndex((tab) => tab.id === displayActiveId)
  // When the LAST tab is active, the trailing new-conversation wrapper is its
  // right neighbour — it needs the same baseline inset a tab neighbour gets
  // (`data-adjacent-active`), so the active tab's right reverse-corner foot
  // doesn't leave a stray line poking out from under it (globals.css).
  const lastTabActive = activeIndex >= 0 && activeIndex === groupTabs.length - 1

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-1 items-stretch overflow-hidden pl-2 pt-1.5",
        isDropTarget && "bg-primary/8"
      )}
    >
      {isSplit && zoneName && (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="ml-1 flex max-w-32 shrink-0 items-center gap-1.5 self-center rounded-md bg-foreground/6 px-2 py-1 text-[0.6875rem] font-medium text-muted-foreground"
              title={boundFolder?.path ?? zoneName}
              aria-label={t("folderZone", { name: zoneName })}
            >
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate">{zoneName}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => closeGroup(stripGroupId)}>
              <X className="h-4 w-4" />
              {t("closeFolderZone", { name: zoneName })}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      <Reorder.Group
        as="div"
        ref={scrollRef}
        role="tablist"
        axis="x"
        values={groupTabs}
        onReorder={handleReorder}
        onWheel={handleWheel}
        // Cross-group drop target: group strips advertise their group id for the
        // drag hit-test and tint while a foreign tab hovers.
        data-conv-group-strip={groupId ?? undefined}
        // Tabs still share available width like browser tabs, but stop shrinking
        // at a readable minimum (TabItem). Past that point this becomes a native
        // horizontal scroller with its scrollbar visually hidden. The active tab
        // is scrolled into view by the effect above, and a mouse wheel can browse
        // the rest. The new-conversation control lives OUTSIDE this viewport so
        // it never disappears with the overflowed tabs.
        className="tab-strip-scroll flex h-full min-w-0 flex-1 items-stretch gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        {groupTabs.map((tab, index) => {
          const folderInfo = folderIndex.get(tab.folderId)
          // Drafts are group-bound: no cross-group drag, no move / split-and-move
          // menu items. Within-group sorting (the Reorder.Group itself) is
          // untouched. See `moveTabToGroup` for why.
          const isDraft = tab.conversationId == null
          const compatibleMoveTargets = moveTargets.filter(
            (target) =>
              groupFolder[target.groupId] == null ||
              groupFolder[target.groupId] === OTHER_FOLDER_ZONE_ID ||
              groupFolder[target.groupId] === tab.folderId
          )
          // Neighbours of the active tab inset their workspace-bg baseline so the
          // active tab's transparent reverse-corner foot (which flares over them)
          // doesn't leave a stray line under it (globals.css `data-adjacent-active`).
          const adjacentActive =
            activeIndex < 0
              ? undefined
              : index === activeIndex - 1
                ? "before"
                : index === activeIndex + 1
                  ? "after"
                  : undefined
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              isActive={tab.id === displayActiveId}
              isTileMode={isTileMode}
              embedded
              adjacentActive={adjacentActive}
              folderName={folderInfo?.name ?? null}
              folderBranch={branches.get(tab.folderId) ?? null}
              isSplit={isSplit}
              canSplitMove={canSplitMove && !isDraft}
              canMoveToGroup={!isDraft && compatibleMoveTargets.length > 0}
              moveTargets={compatibleMoveTargets}
              onTabDrag={
                crossDragEnabled && !isDraft ? handleTabDrag : undefined
              }
              onTabDragEnd={
                crossDragEnabled && !isDraft ? handleTabDragEnd : undefined
              }
              onSwitch={switchTab}
              onClose={closeTab}
              onCloseOthers={closeOtherTabs}
              onCloseAll={closeAllTabs}
              onPin={pinTab}
              onToggleTile={handleToggleTile}
              onSplit={handleSplit}
              onMoveToGroup={moveTabToGroup}
              onToggleSplitOrientation={handleToggleSplitOrientation}
              onUnsplit={handleUnsplit}
              onUnsplitAll={unsplitAll}
              isCoarsePointer={isCoarsePointer}
              isTouchSorting={touchSortingTabId === tab.id}
              onTouchSortingStart={setTouchSortingTabId}
              onTouchSortingEnd={handleTouchSortingEnd}
            />
          )
        })}
        {/* Own the unused part of a short strip and its bottom hairline. At
            overflow this collapses to a tiny end inset so the last tab's reverse
            corner is not clipped by the scroll viewport. */}
        <div
          data-adjacent-active={lastTabActive ? "after" : undefined}
          className="relative h-full min-w-2 flex-1 ws-strip-line"
        />
      </Reorder.Group>
      {/* Kept outside the scrolling viewport: creating a conversation and
          grabbing the window remain available regardless of the tab count. */}
      <div
        // `relative` anchors two decorative pseudo-elements: the
        // `data-adjacent-active` inset baseline (globals.css `.ws-strip-line`
        // `::after`) used when the last tab is active, and the `tab-strip-tail`
        // `::before` vertical separator shown between the last NON-active tab and
        // the new-conversation button. Inter-tab separators sit on each tab's
        // LEFT edge (`.browser-tab-item::before`), so the last tab's RIGHT edge —
        // where this flush-pinned button begins — otherwise has none. Only the
        // conversation strip carries `tab-strip-tail`; the file strip floats its
        // trailing button far-right past a drag spacer, so it stays divider-free.
        className="tab-strip-tail relative flex h-full shrink-0 items-stretch ws-strip-line"
      >
        <button
          type="button"
          onClick={handleNewConversation}
          // Ghost-style CIRCULAR icon button, evenly inset from the strip's three
          // visible edges so its round hover fill never touches the last tab.
          // `self-start` seats it against the group's `pt-1.5` top rather than
          // centering in the pt-shortened trailing box: with `h-7` on the `h-10`
          // strip that yields an equal 6px top and 6px bottom gap, so its center
          // still lands on the strip midline (matching the tab content). `ml-1.5`
          // adds a matching 6px LEFT gap from the last tab's edge. The hover uses
          // the chrome-standard adaptive tint (`bg-foreground/10`, matching the
          // bottom branch/command blocks) plus `backdrop-blur-sm`: over the fully
          // transparent strip (workspace bg image on) the fill reads as frosted
          // glass rather than a muddy patch, and the tint is clearly visible in
          // both light and dark themes (unlike the old near-white `bg-accent/40`).
          className="ml-1.5 mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full text-muted-foreground backdrop-blur-sm transition-colors hover:bg-foreground/10 hover:text-foreground"
          aria-label={t("newConversation")}
          title={t("newConversation")}
        >
          <SquarePen className="h-3.5 w-3.5" />
        </button>
        {/* Drag spacer, floored at `min-w-10` (40px) instead of `min-w-0`: even
            when many tabs overflow and squeeze this region, a grabbable
            window-drag gap always remains to the RIGHT of the new-conversation
            button, so the button never reaches the strip's right edge and the
            packed strip stays draggable. Group strips keep the drag region too:
            while split there is NO dedicated title-bar row above the shells
            (the workspace layout drops it), so each strip's tail is that
            group's slice of the window-drag surface — for the top row it IS
            the title bar, and lower rows offer the same grab area, mirroring
            the unsplit strip. */}
        <div data-tauri-drag-region className="h-full min-w-10 flex-1" />
      </div>
    </div>
  )
}
