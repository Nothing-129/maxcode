import type { SplitDirection } from "@/lib/tab-group-layout"
import {
  groupOfTab,
  OTHER_FOLDER_ZONE_ID,
  useTabStore,
} from "@/stores/tab-store"

/** Keep the center available for moving between groups, with bounded edge zones. */
export function splitDirectionAt(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number }
): SplitDirection | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const dx = x - rect.left
  const dy = y - rect.top
  if (dx < 0 || dy < 0 || dx > rect.width || dy > rect.height) return null
  const edges: [SplitDirection, number][] = [
    ["left", dx / Math.min(100, rect.width / 4)],
    ["right", (rect.width - dx) / Math.min(100, rect.width / 4)],
    ["up", dy / Math.min(100, rect.height / 4)],
    ["down", (rect.height - dy) / Math.min(100, rect.height / 4)],
  ]
  edges.sort((a, b) => a[1] - b[1])
  return edges[0][1] <= 1 ? edges[0][0] : null
}

export function sidebarConversationDropTarget(x: number, y: number) {
  // Split layout is a desktop interaction; mobile stays one active pane.
  if (window.innerWidth < 768) return null
  const hit = document.elementFromPoint(x, y)
  const shell = hit?.closest<HTMLElement>("[data-conv-group-shell]")
  if (!shell) return null
  const gid = shell.dataset.convGroupShell
  if (!gid) return null
  return {
    gid,
    direction: splitDirectionAt(x, y, shell.getBoundingClientRect()),
  }
}

export function conversationDropTarget(tabId: string, x: number, y: number) {
  const target = sidebarConversationDropTarget(x, y)
  if (!target) return null
  const { gid, direction } = target
  const st = useTabStore.getState()
  const tab = st.rawTabs.find((item) => item.id === tabId)
  if (!tab) return null
  const source = groupOfTab(st.groupOf, st.groupLayout, tabId)
  if (source === gid && !direction) return null
  if (source !== gid && tab.conversationId == null) return null
  const binding = st.groupFolder[gid]
  if (
    !direction &&
    binding != null &&
    binding !== OTHER_FOLDER_ZONE_ID &&
    binding !== tab.folderId
  )
    return null
  return target
}
