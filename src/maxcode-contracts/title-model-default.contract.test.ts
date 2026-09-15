import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import zhCNMessages from "@/i18n/messages/zh-CN.json"
import { source } from "./contract-source"

describe("MaxCode contract: default conversation title model", () => {
  it("prefills the reviewed free Groq setup while leaving the secret to the user", () => {
    const settings = source("src-tauri/src/commands/system_settings.rs")
    const settingsUi = source(
      "src/components/settings/system-network-settings.tsx"
    )

    expect(settings).toContain(
      'DEFAULT_TITLE_MODEL_BASE_URL: &str = "https://api.groq.com/openai/v1"'
    )
    expect(settings).toContain(
      'DEFAULT_TITLE_MODEL_NAME: &str = "qwen/qwen3.8-27b"'
    )
    expect(settings).toContain(
      'DEFAULT_TITLE_MODEL_REASONING_EFFORT: &str = "none"'
    )
    expect(settings).toContain("api_key_configured: false")
    expect(settings).toContain(
      "the suggested configuration must stay inactive until the user saves a key"
    )
    expect(settingsUi).toContain(
      'GROQ_API_KEYS_URL = "https://console.groq.com/keys"'
    )
    expect(settingsUi).toContain("<BrowserLink")
    expect(settingsUi).toContain('t("titleModelGroqSignup")')
    expect(enMessages.SystemSettings.titleModelGroqSignup).toContain("Groq")
    expect(zhCNMessages.SystemSettings.titleModelGroqSignup).toContain("Groq")
  })

  it("keeps the signup guidance localized in every supported language", () => {
    for (const locale of [
      "ar",
      "de",
      "en",
      "es",
      "fr",
      "ja",
      "ko",
      "pt",
      "zh-CN",
      "zh-TW",
    ]) {
      const messages = JSON.parse(
        source(`src/i18n/messages/${locale}.json`)
      ) as typeof enMessages
      expect(
        messages.SystemSettings.titleModelGroqApiKeyPlaceholder,
        locale
      ).toBeTruthy()
      expect(messages.SystemSettings.titleModelGroqSignup, locale).toBeTruthy()
    }
  })
})
