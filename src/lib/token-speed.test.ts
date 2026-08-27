import { describe, expect, it } from "vitest"
import {
  countChars,
  estimateTokens,
  TokenCountAccumulator,
  TokenSpeedTracker,
} from "./token-speed"

describe("estimateTokens", () => {
  it("counts non-CJK code points at 4 chars per token", () => {
    expect(estimateTokens("hello world")).toBeCloseTo(11 / 4)
  })

  it("counts CJK at one code point per token", () => {
    expect(estimateTokens("你好世界")).toBe(4)
  })

  it("counts whitespace as non-CJK, matching pi-web", () => {
    expect(estimateTokens("  a b  ")).toBeCloseTo(7 / 4)
    expect(estimateTokens("   ")).toBeCloseTo(3 / 4)
  })

  it("mixes CJK and other characters", () => {
    expect(estimateTokens("你好 world")).toBeCloseTo(2 + 6 / 4)
  })

  it("uses pi-web's exact CJK ranges", () => {
    expect(countChars("これはテストです")).toEqual({ dense: 8, other: 0 })
    expect(countChars("한국어 출력")).toEqual({ dense: 5, other: 1 })
    expect(countChars("你好。世界、")).toEqual({ dense: 6, other: 0 })
    expect(countChars("你　好")).toEqual({ dense: 3, other: 0 })
    // Fullwidth punctuation lies outside pi-web's CJK pattern.
    expect(countChars("，！")).toEqual({ dense: 0, other: 2 })
  })

  it("counts astral CJK and emoji as one code point each", () => {
    expect(countChars("𠀀𠀁")).toEqual({ dense: 2, other: 0 })
    expect(countChars("🚀")).toEqual({ dense: 0, other: 1 })
    expect(estimateTokens("🚀")).toBeCloseTo(1 / 4)
  })

  it("returns zero for empty text", () => {
    expect(estimateTokens("")).toBe(0)
  })
})

describe("TokenCountAccumulator", () => {
  function pass(acc: TokenCountAccumulator, texts: string[]): number {
    acc.beginPass()
    for (const text of texts) acc.push(text)
    return acc.endPass()
  }

  it("matches a whole-string measure as blocks grow", () => {
    const acc = new TokenCountAccumulator()
    let text = ""
    for (const chunk of ["Hello ", "世界，", "これは", " a test", " 한국어"]) {
      text += chunk
      expect(pass(acc, [text])).toBeCloseTo(estimateTokens(text))
    }
  })

  it("sums blocks, appends new content and drops removed blocks", () => {
    const acc = new TokenCountAccumulator()
    expect(pass(acc, ["abcd", "你好"])).toBeCloseTo(1 + 2)
    expect(pass(acc, ["abcdefgh", "你好", "xyzw"])).toBeCloseTo(2 + 2 + 1)
    expect(pass(acc, ["abcdefgh"])).toBeCloseTo(2)
  })

  it("remeasures replacements, including same-length replacements", () => {
    const acc = new TokenCountAccumulator()
    expect(pass(acc, ["aaaa"])).toBeCloseTo(1)
    expect(pass(acc, ["你好世界"])).toBeCloseTo(4)
    expect(pass(acc, ["你好"])).toBeCloseTo(2)
  })

  it("correctly completes a surrogate pair across streamed appends", () => {
    const acc = new TokenCountAccumulator()
    const astralCjk = "𠀀"
    expect(pass(acc, [astralCjk.slice(0, 1)])).toBeCloseTo(1 / 4)
    expect(pass(acc, [astralCjk])).toBeCloseTo(1)

    acc.reset()
    const emoji = "🚀"
    expect(pass(acc, [emoji.slice(0, 1)])).toBeCloseTo(1 / 4)
    expect(pass(acc, [emoji])).toBeCloseTo(1 / 4)
  })

  it("resets to zero", () => {
    const acc = new TokenCountAccumulator()
    pass(acc, ["aaaa"])
    acc.reset()
    expect(pass(acc, [])).toBe(0)
  })
})

describe("TokenSpeedTracker", () => {
  it("starts on the first non-zero observation and excludes TTFT", () => {
    const tracker = new TokenSpeedTracker()
    expect(tracker.observe(0, 0)).toBeNull()
    expect(tracker.observe(0, 10_000)).toBeNull()
    expect(tracker.observe(20, 10_300)).toBeNull()
    expect(tracker.observe(80, 10_900)).toBeCloseTo(80 / 0.6)
  })

  it("withholds the reading through pi-web's half-second warmup", () => {
    const tracker = new TokenSpeedTracker()
    tracker.observe(10, 0)
    expect(tracker.observe(20, 500)).toBeNull()
    expect(tracker.observe(25, 501)).toBeCloseTo(25 / 0.501)
  })

  it("reports cumulative rather than rolling rate", () => {
    const tracker = new TokenSpeedTracker()
    tracker.observe(10, 0)
    expect(tracker.observe(110, 1000)).toBeCloseTo(110)
    expect(tracker.observe(210, 2000)).toBeCloseTo(105)
  })

  it("lets an in-generation silent interval lower the cumulative rate", () => {
    const tracker = new TokenSpeedTracker()
    tracker.observe(100, 0)
    expect(tracker.observe(100, 1000)).toBeCloseTo(100)
    expect(tracker.observe(100, 2000)).toBeCloseTo(50)
  })

  it("resets for a new model generation", () => {
    const tracker = new TokenSpeedTracker()
    tracker.observe(100, 0)
    tracker.observe(200, 1000)
    tracker.reset()
    expect(tracker.observe(20, 5000)).toBeNull()
    expect(tracker.observe(80, 5600)).toBeCloseTo(80 / 0.6)
  })
})
