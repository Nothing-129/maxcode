import { describe, expect, it } from "vitest"
import {
  canShowGenerationStats,
  chooseGenerationStatsDisplayMode,
} from "@/components/chat/composer-generation-stats"
import { source } from "./contract-source"

describe("mobile composer navigation priority", () => {
  it("reserves folder and branch width without displacing the connection control", () => {
    const input = source("src/components/chat/message-input.tsx")
    const navigation = input.slice(
      input.indexOf('data-composer-navigation=""'),
      input.indexOf("<ConversationFolderBranchPicker")
    )
    expect(navigation).toContain("max-md:w-max")
    expect(navigation).toContain("max-md:shrink-0")
    expect(navigation).toContain("max-md:max-w-[calc(100%-2.5rem)]")
    const stats = source("src/components/chat/composer-generation-stats.tsx")
    expect(stats).toContain("left.getBoundingClientRect().width")
    expect(stats).toContain("observer.observe(left)")
  })

  it("drops optional performance metrics as navigation grows and restores them when room returns", () => {
    const display = (leftWidth: number) => {
      const fits = (statsWidth: number) =>
        canShowGenerationStats({
          rowWidth: 390,
          rowPadding: 16,
          leftWidth,
          outerGap: 8,
          rightControlWidths: [60, 32],
          rightGap: 0,
          statsWidth,
        })
      return chooseGenerationStatsDisplayMode(fits(180), fits(52))
    }
    expect([80, 190, 270, 190, 80].map(display)).toEqual([
      "full",
      "throughput",
      "hidden",
      "throughput",
      "full",
    ])
  })
})
