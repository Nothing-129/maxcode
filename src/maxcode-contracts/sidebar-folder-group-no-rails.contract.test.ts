import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("folder group indentation", () => {
  it("keeps folder and group hover neutral across accent themes", () => {
    for (const path of [
      "src/components/conversations/sidebar-conversation-list.tsx",
      "src/components/conversations/sidebar-folder-group-header.tsx",
    ]) {
      expect(source(path)).toContain(
        "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
      )
    }
  })

  it("adds the same folder inset to normal, dragged and sticky rows", () => {
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(list).toContain('isFolderSectionContent(row) && "pl-2.5"')
    expect(list).toContain('className="flex flex-col pl-2.5"')
    expect(list).toContain('"pl-[1.125rem] pr-2 [--conv-rail-axis:0.875rem]"')
    expect(list).toContain(
      'row.kind === "conversation" && isFolderConversationRow(row)'
    )
  })

  it("omits group rails while retaining the immediate worktree connector", () => {
    const list = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(list).toContain(`{variant !== "repo" ? (
                  <SubsessionAncestorRails depth={depth} from={depth - 1} />
                ) : null}`)
    expect(list).toContain(
      "(isRootGroup || isWorktree ? 1 : 0) + groupDepth(folderId)"
    )
  })
})
