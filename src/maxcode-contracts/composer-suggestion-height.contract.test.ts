import { describe, expect, it } from "vitest"
import { COMPOSER_SIZING } from "@/components/chat/composer/composer-sizing"
import { source } from "./contract-source"

describe("suggestion adoption preserves single-line composer height", () => {
  it("fits suggestion adoption into the original 32px action row", () => {
    const input = source("src/components/chat/message-input.tsx")
    expect(input).toContain(
      "maxcode-composer-actions flex min-h-8 shrink-0 items-center"
    )
    expect(
      source("src/components/chat/composer/accept-prompt-suggestion.tsx")
    ).toContain("size-8")

    // Unlayered motion CSS overrides Tailwind utilities even when the
    // utility is more specific. It must leave action-row geometry alone.
    const motion = source("src/app/interaction-motion.css")
    const rowRules = [...motion.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, selector]) =>
        selector
          .split(",")
          .some((part) => part.trim() === ".maxcode-composer-actions")
    )
    for (const [, , declarations] of rowRules) {
      expect(declarations).not.toMatch(/(?:min-|max-)?height\s*:/)
    }
  })

  it("keeps compact and tall floors with the original action row", () => {
    for (const { boxRem, editable } of Object.values(COMPOSER_SIZING)) {
      const editableRem = Number(editable.match(/\[([\d.]+)rem\]/)![1])
      // 32px actions + 8px bottom padding + two 1px borders, at 16px/rem.
      expect(editableRem + 2 + 0.5 + 0.125).toBe(boxRem)
      // One 21px line and 28px editor padding fit without growing the box.
      expect(editableRem * 16).toBeGreaterThanOrEqual(21 + 28)
    }
  })
})
