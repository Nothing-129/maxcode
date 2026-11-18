import { describe, expect, it } from "vitest"
import { composerMenuAlignOffset } from "@/lib/composer-menu-position"

describe("folder popup aligns to the input rather than its inset chip", () => {
  it.each([8, 16, 24])("compensates a %ipx chip inset", (inset) => {
    const trigger = { left: 100 + inset, right: 220 + inset }
    const input = { left: 100, right: 600 }
    expect(trigger.left + composerMenuAlignOffset(trigger, input)).toBe(
      input.left
    )
  })
  it("aligns the input's start edge in RTL", () => {
    const trigger = { left: 460, right: 580 }
    const input = { left: 100, right: 600 }
    expect(trigger.right - composerMenuAlignOffset(trigger, input, true)).toBe(
      input.right
    )
  })
})
