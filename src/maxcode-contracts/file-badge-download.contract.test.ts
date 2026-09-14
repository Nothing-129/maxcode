import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: file badges can download remote workspace files", () => {
  it("adds download beside the existing reveal and copy actions", () => {
    const actions = source("src/components/message/file-reference-actions.tsx")
    expect(actions).toContain("downloadWorkspaceFile")
    expect(actions).toContain("isWorkspaceFileApiAvailable")
    expect(actions).toContain("openWithDefaultApp")
    expect(actions).toContain("copyRelativePath")
    expect(actions).toContain("copyAbsolutePath")
  })

  it("exports the same availability gate the file tree uses", () => {
    const api = source("src/lib/api.ts")
    expect(api).toContain("export function isWorkspaceFileApiAvailable")
    expect(api).toContain("export async function downloadWorkspaceFile")
  })
})
