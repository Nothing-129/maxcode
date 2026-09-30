import { describe, expect, it } from "vitest"

import { piRuntimeIsTooOld, piUsesCustomAgentDir } from "@/lib/pi-config"
import {
  clampThinkingLevel,
  reasoningFromModel,
  reasoningToMap,
  supportedLevels,
} from "@/lib/pi-thinking"
import type { AcpAgentInfo } from "@/lib/types"

describe("MaxCode Pi runtime and thinking contract", () => {
  it("keeps a global max preference while individual models clamp it", () => {
    const preference = "max"
    const ordinary = supportedLevels({ reasoning: true, thinkingLevelMap: {} })
    const extended = supportedLevels({
      reasoning: true,
      thinkingLevelMap: { max: "max", xhigh: null },
    })
    expect(clampThinkingLevel(preference, ordinary)).toBe("high")
    expect(clampThinkingLevel(preference, extended)).toBe("max")
    expect(preference).toBe("max")
  })

  it("preserves explicit custom max and provider wire mappings through save", () => {
    const map = {
      off: "none",
      minimal: null,
      low: "LOW",
      medium: null,
      high: "HIGH",
      xhigh: null,
      max: "MAX",
    } as const
    const model = reasoningFromModel(true, map)
    expect(reasoningToMap(model)).toEqual(map)
    expect(clampThinkingLevel("medium", model.levels)).toBe("high")
  })

  it("treats runtime versions as advisory and custom profiles as Pi only", () => {
    expect(piRuntimeIsTooOld("0.80.2")).toBe(true)
    for (const version of ["0.81.0", "0.81.1", "0.0.0", "custom", null]) {
      expect(piRuntimeIsTooOld(version)).toBe(false)
    }
    const env = { PI_CODING_AGENT_DIR: "/profiles/pi" }
    expect(
      piUsesCustomAgentDir({ agent_type: "pi", env } as unknown as AcpAgentInfo)
    ).toBe(true)
    expect(
      piUsesCustomAgentDir({
        agent_type: "codex",
        env,
      } as unknown as AcpAgentInfo)
    ).toBe(false)
  })
})
