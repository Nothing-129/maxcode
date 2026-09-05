import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: public share link rendering", () => {
  it("keeps shared thinking available but collapsed like the desktop", () => {
    const view = source(
      "src/components/conversations/shared-conversation-view.tsx"
    )
    const reasoning = source("src/components/ai-elements/reasoning.tsx")

    expect(view).toContain("<Reasoning defaultOpen={false}>")
    expect(view).toContain("<ReasoningTrigger />")
    expect(view).toContain('<ReasoningContent linkMode="public">')
    expect(reasoning).toContain('linkMode?: "workspace" | "public"')
    expect(reasoning).toContain('linkMode === "public"')
    expect(reasoning).toContain("publicReasoningComponents")
  })

  it("renders shared Markdown without requiring a workspace provider", () => {
    const view = source(
      "src/components/conversations/shared-conversation-view.tsx"
    )
    const message = source("src/components/ai-elements/message.tsx")

    expect(view).toContain('<MessageResponse linkMode="public">')
    expect(message).toContain('linkMode?: "workspace" | "public"')
    expect(message).toContain('linkMode === "public"')
    expect(message).toContain("publicMarkdownLinkComponents")
  })

  it("keeps external links openable and workspace targets inert", () => {
    const links = source("src/components/ai-elements/markdown-link.tsx")
    const publicStart = links.indexOf("export function PublicMarkdownLink")
    const publicEnd = links.indexOf(
      "export const markdownLinkComponents",
      publicStart
    )
    const publicRenderer = links.slice(publicStart, publicEnd)

    expect(publicStart).toBeGreaterThanOrEqual(0)
    expect(publicEnd).toBeGreaterThan(publicStart)
    expect(publicRenderer).toContain("publicExternalHref(href)")
    expect(publicRenderer).toContain("<BrowserLink")
    expect(publicRenderer).not.toContain("useStreamdownLinkSafety")
    expect(publicRenderer).not.toContain("useWorkspaceActions")
    expect(links).toContain("PUBLIC_EXTERNAL_PROTOCOL")
    expect(links).toContain('if (value.startsWith("//"))')
  })
})
