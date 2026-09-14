import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: binary image diffs stay visible and bounded", () => {
  it("reads immutable Git blobs with an explicit per-side size ceiling", () => {
    const folders = source("src-tauri/src/commands/folders.rs")
    const imageDiff = source("src/lib/image-diff.ts")

    expect(folders).toContain("pub async fn git_show_file_base64")
    expect(folders).toContain('.args(["cat-file", "-s", &oid])')
    expect(folders).toContain('.args(["cat-file", "blob", &oid])')
    expect(folders).toContain("ref_missing")
    expect(folders).toContain("too_large")
    expect(imageDiff).toContain("const IMAGE_DIFF_MAX_BYTES = 8 * 1024 * 1024")
    expect(imageDiff).toContain('source.kind === "worktree"')
    expect(imageDiff).toContain("source.missingRefIsAbsent")
  })

  it("renders image changes across the existing Git review surfaces", () => {
    const workspace = source("src/contexts/workspace-context.tsx")
    const unified = source("src/components/diff/unified-diff-preview.tsx")

    expect(workspace).toContain("imageDiff?: ImageDiffSides")
    expect(workspace).toContain("loadImageDiffSides(")
    expect(unified).toContain("file.hunks.length > 0 || file.binary")
    expect(unified).toContain("file.binary")

    for (const path of [
      "src/components/files/file-workspace-panel.tsx",
      "src/components/layout/commit-dialog.tsx",
      "src/components/layout/push-workspace.tsx",
      "src/components/layout/unstash-dialog.tsx",
    ]) {
      expect(source(path)).toContain("ImageDiffView")
    }
  })

  it("preserves MaxCode desktop handling for non-previewable artifacts", () => {
    const workspace = source("src/contexts/workspace-context.tsx")
    expect(workspace).toContain("shouldOpenWithSystemApp(absPath)")
    expect(workspace).toContain("isLocalDesktop()")
    expect(workspace).toContain("await openPath(absPath)")
  })
})
