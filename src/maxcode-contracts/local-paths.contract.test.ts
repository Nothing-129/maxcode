import { describe, expect, it } from "vitest"

import { remarkAutolinkLocalPaths } from "@/components/ai-elements/remark-autolink-local-paths"
import { buildFilePathReferenceUri } from "@/components/chat/composer/reference-uri"

type Node = {
  type: string
  url?: string
  value?: string
  children?: Node[]
}

describe("MaxCode contract: local artifact paths", () => {
  it("turns a plain generated artifact path into an actionable file URI", () => {
    const path = "src-tauri/target/release/bundle/dmg/MaxCode.dmg"
    const tree: Node = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: path }] },
      ],
    }

    remarkAutolinkLocalPaths()(tree)
    const link = tree.children?.[0]?.children?.[0]
    expect(link).toMatchObject({
      type: "link",
      url: buildFilePathReferenceUri(path),
    })
    expect(link?.children?.[0]?.value).toBe(path)
  })
})
