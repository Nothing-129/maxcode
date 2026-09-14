import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: local Markdown images render inline", () => {
  it("rewrites image destinations without replacing file-link badges", () => {
    const message = source("src/components/ai-elements/message.tsx")
    expect(message).toContain("remarkLocalImages")
    expect(message).toContain("markdownLocalImageComponents")
    expect(message).toContain("markdownLinkComponents")
    expect(message).toContain("remarkAutolinkLocalPaths")

    const rehype = source("src/components/ai-elements/rehype-allow-codeg.ts")
    expect(rehype).toContain("data-codeg-local-image")
    expect(rehype).toContain("dataCodegLocalImage")
  })

  it("scopes image loading to the transcript working directory", () => {
    const list = source("src/components/message/message-list-view.tsx")
    expect(list).toContain("MarkdownImageProvider")
    expect(list).toContain("imageRoot")
    expect(source("src/lib/markdown-local-image.ts")).toContain(
      "export function resolveLocalImage"
    )
  })
})
