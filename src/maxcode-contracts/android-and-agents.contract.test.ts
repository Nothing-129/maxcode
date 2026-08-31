import { describe, expect, it } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import zhCNMessages from "@/i18n/messages/zh-CN.json"
import { PI_THINKING_LEVELS, reasoningToMap } from "@/lib/pi-thinking"
import { source, sourceExists } from "./contract-source"

describe("MaxCode contract: agent compatibility", () => {
  it("keeps Pi's maximum reasoning option wired and localized", () => {
    expect(PI_THINKING_LEVELS[PI_THINKING_LEVELS.length - 1]).toBe("max")
    expect(
      reasoningToMap({ enabled: true, levels: ["max"], wireValues: {} }).max
    ).toBe("max")
    expect(enMessages.AcpAgentSettings.pi.thinking.max).toBe("Maximum")
    expect(zhCNMessages.AcpAgentSettings.pi.thinking.max).toBe("最高")
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
      expect(messages.AcpAgentSettings.pi.thinking.max, locale).toBeTruthy()
    }
  })

  it("keeps locale-aware CLI titles and Grok history filtering", () => {
    const titles = source("src-tauri/src/session_title.rs")
    const grok = source("src-tauri/src/parsers/grok.rs")
    expect(titles).toContain("resolve_title_locale")
    expect(titles).toContain("title_prompt_follows_locale")
    expect(titles).toContain("is_grok_title_scratch_cwd")
    expect(grok).toContain("is_redundant_session_image_read")
    expect(grok).toContain('"plan" =>')
  })

  it("keeps built-in ACP discovery and CLI preflight integration", () => {
    const registry = source("src-tauri/src/acp/registry.rs")
    const preflight = source("src-tauri/src/acp/preflight.rs")
    expect(registry).toContain("AgentType::")
    expect(preflight).toContain("preflight")
    expect(sourceExists("src-tauri/src/acp/codex_catalog_source.rs")).toBe(true)
  })
})

describe("MaxCode contract: Android WebView client", () => {
  it("keeps saved connections, health checks, secure token storage, and Oppo safe areas", () => {
    for (const path of [
      "android-webview/app/src/main/java/app/codeg/web/ConnectionCatalog.java",
      "android-webview/app/src/main/java/app/codeg/web/SecureConfigStore.java",
      "android-webview/app/src/main/java/app/codeg/web/ServerHealthChecker.java",
      "android-webview/app/src/main/java/app/codeg/web/DeviceCompatibility.java",
    ]) {
      expect(sourceExists(path), path).toBe(true)
    }
    expect(
      source(
        "android-webview/app/src/main/java/app/codeg/web/MainActivity.java"
      )
    ).toContain("needsOppoStatusBarWorkaround")
    expect(
      source(
        "android-webview/app/src/main/java/app/codeg/web/WebBootstrapScript.java"
      )
    ).toContain("--maxcode-android-status-bar-inset")
    const secureStore = source(
      "android-webview/app/src/main/java/app/codeg/web/SecureConfigStore.java"
    )
    expect(secureStore).toContain("AndroidKeyStore")
    expect(secureStore).toContain("AES/GCM/NoPadding")
  })
})
