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

  it("keeps configurable locale-aware HTTP titles and Grok history filtering", () => {
    const titles = source("src-tauri/src/session_title.rs")
    const settings = source("src-tauri/src/commands/system_settings.rs")
    const settingsUi = source(
      "src/components/settings/system-network-settings.tsx"
    )
    const webSettings = source("src-tauri/src/web/handlers/system_settings.rs")
    const api = source("src/lib/api.ts")
    const grok = source("src-tauri/src/parsers/grok.rs")
    const parsers = source("src-tauri/src/parsers/mod.rs")
    expect(titles).toContain("resolve_title_locale")
    expect(titles).toContain("title_prompt_follows_locale")
    expect(titles).toContain("AgentType::Grok | AgentType::Pi")
    expect(titles).toContain("llm_title_via_api")
    expect(titles).toContain("redact_title_input")
    expect(titles).toContain("body.extend(settings.request_params.clone())")
    expect(titles).toContain(
      "title_prompt_redacts_before_applying_the_400_character_limit"
    )
    expect(titles).toContain(
      "can_overwrite_multiline_frontend_and_parser_seeds"
    )
    expect(parsers).toContain("crate::session_title::redact_title_input")
    expect(titles).toContain('"temperature": 0')
    expect(titles).not.toContain("tokio::process::Command")
    expect(titles).toContain("is_grok_title_scratch_cwd")
    expect(settings).toContain("SYSTEM_TITLE_MODEL_SETTINGS_KEY")
    expect(settings).toContain("api_key_configured")
    expect(settings).toContain("test_system_title_model_settings_core")
    expect(settings).toContain("normalize_title_model_request_params")
    expect(webSettings).toContain(
      "settings_commands::test_system_title_model_settings_core"
    )
    expect(api).toContain(
      'getTransport().call("test_system_title_model_settings"'
    )
    expect(settingsUi).toContain('t("titleModelTitle")')
    expect(settingsUi).toContain('t("titleModelTest")')
    expect(settingsUi).toContain('t("titleModelPrivacyHint")')
    expect(settingsUi).toContain('t("titleModelRequestParams")')
    expect(grok).toContain("is_redundant_session_image_read")
    expect(grok).toContain('"plan" =>')
  })

  it("keeps generated titles tied to the Shanghai conversation creation date", () => {
    const titles = source("src-tauri/src/session_title.rs")
    expect(titles).toContain("let created_at = summary.created_at;")
    expect(titles).not.toContain("let created_at = summary.updated_at;")
    expect(titles).toContain("with_timezone(&Shanghai)")
    expect(titles).toContain('format("%m%d")')
    expect(titles).toContain("MMDD｜类型｜主题")
    expect(titles).toContain("功能、设计、修复、优化、发布、探索、文档、研究")
    expect(titles).toContain("无法判断主题时不要猜，原样输出当前标题")
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
