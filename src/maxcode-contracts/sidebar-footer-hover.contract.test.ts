import { describe, expect, it } from "vitest"
import { statusBarActionClassName } from "@/components/layout/status-bar-action"
import { source } from "./contract-source"

describe("consistent sidebar footer hover", () => {
  it("only brightens text on hover across all footer text actions", () => {
    for (const file of [
      "status-bar-stats.tsx",
      "status-bar-update.tsx",
      "sidebar-codex-quota.tsx",
    ]) {
      const code = source(`src/components/layout/${file}`)
      expect(code).toContain('from "./status-bar-action"')
      expect(code).toMatch(/cn\(\s*statusBarActionClassName,/)
    }
    expect(statusBarActionClassName).not.toMatch(/(?:hover:|data-\[.*?\]:)bg-/)
    const classes = statusBarActionClassName.split(" ")
    expect(classes).toEqual(
      expect.arrayContaining([
        "h-6",
        "rounded",
        "px-1",
        "cursor-pointer",
        "enabled:hover:text-foreground",
        "focus-visible:ring-2",
        "disabled:cursor-default",
      ])
    )
  })
})
