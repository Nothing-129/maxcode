import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

it("keeps the history entry subtle and accessible while loading", () => {
  const source = readFileSync(
    "src/components/message/virtualized-message-thread.tsx",
    "utf8"
  )
  const entry = source.slice(
    source.indexOf('<div key="load-older-row"'),
    source.indexOf("{items.map")
  )
  expect(entry).toContain("<ChevronUp")
  expect(entry).toContain("focus-visible:ring-2")
  expect(entry).toContain("aria-busy={isLoadingOlder}")
  expect(entry).toContain("disabled={isLoadingOlder}")
  expect(entry).toContain("{loadingOlderLabel}")
  expect(entry).not.toContain("rounded-full")
  expect(entry).not.toContain("border-border")
})
