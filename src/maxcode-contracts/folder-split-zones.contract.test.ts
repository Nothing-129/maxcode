import { describe, expect, it } from "vitest"

import { leafIds, singleGroupLayout, splitGroup } from "@/lib/tab-group-layout"
import { source } from "./contract-source"

describe("MaxCode contract: folder-bound tab splits", () => {
  it("supports deterministic left and right placement", () => {
    const root = singleGroupLayout("workspace-a")
    expect(
      leafIds(splitGroup(root, "workspace-a", "left", "workspace-b"))
    ).toEqual(["workspace-b", "workspace-a"])
    expect(
      leafIds(splitGroup(root, "workspace-a", "right", "workspace-b"))
    ).toEqual(["workspace-a", "workspace-b"])
  })

  it("keeps the sidebar entry points and folder-aware routing wired", () => {
    const sidebar = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(sidebar).toContain("openInLeftSplit")
    expect(sidebar).toContain("openInRightSplit")
    expect(sidebar).toContain("openFolderInSplit(folderId, folder.path, side)")

    const store = source("src/stores/tab-store.ts")
    expect(store).toContain("planTargetGroupForFolder")
    expect(store).toContain("folderBindings: st.groupFolder")
    expect(store).toContain("OTHER_FOLDER_ZONE_ID")
    expect(store).toContain("const anchor = leaves[leaves.length - 1]")
    expect(store).toContain("[targetGroup]: OTHER_FOLDER_ZONE_ID")
    expect(store).toContain("targetFolder !== moving.folderId")
    expect(store).toContain("if (targetPlan == null) return false")
  })

  it("keeps each folder-bound zone to one active tab", () => {
    const store = source("src/stores/tab-store.ts")
    expect(store).toContain("function enforceFolderZoneSingleTabs()")
    expect(store).toContain("if (st.groupFolder[groupId] == null) continue")
    expect(store).toContain(
      "const keep = active ?? selected ?? members[members.length - 1]"
    )
    expect(store).toContain("rawTabs: st.rawTabs.filter")
  })

  it("lets seeded drafts and entire folder zones close", () => {
    const store = source("src/stores/tab-store.ts")
    expect(store).toContain("if (closingTab.conversationId == null)")
    expect(store).toContain("set({ rawTabs: [], activeTabId: null })")
    expect(store).toContain("closeGroup: (groupId) =>")
    expect(store).toContain("closingIds.has(tab.id)")
  })

  it("shows folder remarks and a context-menu close action", () => {
    const strip = source("src/components/tabs/tab-bar.tsx")
    expect(strip).toContain("groupFolder[stripGroupId]")
    expect(strip).toContain("boundFolder?.alias?.trim()")
    expect(strip).toContain('t("otherFolderZone")')
    expect(strip).toContain("<ContextMenuTrigger asChild>")
    expect(strip).toContain("closeGroup(stripGroupId)")
  })
})
