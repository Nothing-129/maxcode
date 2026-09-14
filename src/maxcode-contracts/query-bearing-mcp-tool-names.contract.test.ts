import { describe, expect, it } from "vitest"

import { inferLiveToolName } from "@/lib/tool-call-normalization"
import { source } from "./contract-source"

describe("MaxCode contract: query-bearing MCP calls keep their names", () => {
  it("does not treat a query argument as web search by itself", () => {
    expect(
      inferLiveToolName({
        title: "codegraph_explore",
        kind: "other",
        rawInput: JSON.stringify({ query: "find the auth flow" }),
      })
    ).toBe("codegraph_explore")

    expect(
      inferLiveToolName({
        title: "Search for 'find usages'",
        kind: "search",
        rawInput: JSON.stringify({ query: "find usages" }),
      })
    ).toBe("grep")
  })

  it("still classifies Codex and named web-search frames as websearch", () => {
    expect(
      inferLiveToolName({
        title: "web_search",
        kind: "other",
        rawInput: JSON.stringify({ query: "Codeg" }),
      })
    ).toBe("websearch")

    expect(
      inferLiveToolName({
        title: "Open page: https://example.com",
        kind: "search",
        rawInput: JSON.stringify({
          query: "Codeg",
          action: { type: "openPage", url: "https://example.com" },
        }),
      })
    ).toBe("websearch")

    expect(
      inferLiveToolName({
        title: "Search",
        kind: "other",
        rawInput: JSON.stringify({ type: "webSearch", query: "Codeg" }),
      })
    ).toBe("websearch")
  })

  it("gates the query heuristic on an explicit web-search identity", () => {
    const impl = source("src/lib/tool-call-normalization.ts")
    expect(impl).toContain("isCodexWebSearchTitle")
    expect(impl).toContain("isCodexWebSearchType")
    expect(impl).not.toMatch(
      /if \(hasAnyKey\(parsed, \["query"\]\)\) return "websearch"/
    )
  })
})
