import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: collapsing Folders also folds its conversation lists", () => {
  it("persists all open folders as folded only when closing the section", () => {
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    const toggle = list.slice(
      list.indexOf("  const toggleSection ="),
      list.indexOf("  const toggleFolderGroup =")
    )
    expect(toggle).toContain('section === "folders" && foldersExpanded')
    expect(toggle).toContain("useAppWorkspaceStore.getState().folders")
    expect(toggle).toContain("next[folder.id] = false")
    expect(toggle).toContain("folderExpandedRef.current = next")
    expect(toggle).toContain("setFolderExpanded(next)")
    expect(toggle).toContain("saveFolderExpanded(next)")
    expect(toggle).toContain("setFolderLimitById({})")
    expect(toggle).toContain("saveSectionCollapsed(next)")
  })
})
