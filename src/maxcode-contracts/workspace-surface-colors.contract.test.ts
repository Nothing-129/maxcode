import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: GPT-matched workspace surfaces", () => {
  it("keeps the neutral light canvas white and the sidebar cool gray", () => {
    const globals = source("src/app/globals.css")

    const neutral = globals.match(
      /\[data-theme="neutral"\] \{(?<tokens>[\s\S]*?)\n\}/
    )?.groups?.tokens
    const fallback = globals.match(
      /:root:not\(\[data-theme\]\) \{(?<tokens>[\s\S]*?)\n\}/
    )?.groups?.tokens

    expect(neutral).toContain("--background: #ffffff;")
    expect(neutral).toContain("--sidebar: #f9f9fa;")
    expect(fallback).toContain("--background: #ffffff;")
    expect(fallback).toContain("--sidebar: #f9f9fa;")
  })
})
