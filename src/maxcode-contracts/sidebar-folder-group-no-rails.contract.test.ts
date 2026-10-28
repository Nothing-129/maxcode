import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("folder group indentation", () => {
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
