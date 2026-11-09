import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("historical sessions survive a removed model provider", () => {
  it("registers the executable resume/load recovery contract", () => {
    expect(source("src-tauri/src/acp/connection.rs")).toContain(
      '"/../src/maxcode-contracts/session-provider-recovery.contract.rs"'
    )
  })

  it("provides recovery advice in every supported language", () => {
    for (const locale of [
      "en",
      "zh-CN",
      "zh-TW",
      "ja",
      "ko",
      "es",
      "de",
      "fr",
      "pt",
      "ar",
    ]) {
      const messages = JSON.parse(source(`src/i18n/messages/${locale}.json`))
      const findAdvice = (value: Record<string, unknown>): unknown => {
        if (typeof value.sessionProviderMissing === "string") {
          return value.sessionProviderMissing
        }
        for (const child of Object.values(value)) {
          if (child && typeof child === "object") {
            const advice = findAdvice(child as Record<string, unknown>)
            if (advice) return advice
          }
        }
      }
      expect(findAdvice(messages), locale).toBeTypeOf("string")
    }
  })
})
