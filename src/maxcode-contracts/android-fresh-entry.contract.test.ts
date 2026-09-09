import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("Android entry documents bypass legacy caches", () => {
  it("refreshes both stages of native bootstrap without deleting session data", () => {
    const activity = source(
      "android-webview/app/src/main/java/app/codeg/web/MainActivity.java"
    )
    expect(activity).toContain(
      'UrlNormalizer.freshEntry(config.baseUrl(), "/login")'
    )
    expect(activity).toContain(
      'UrlNormalizer.freshEntry(activeConfig.baseUrl(), "/workspace")'
    )
    expect(activity).toContain("WebSettings.LOAD_DEFAULT")
    expect(activity).not.toMatch(
      /clearCache\(|deleteAllData\(|removeAllCookies\(/
    )
    const urls = source(
      "android-webview/app/src/main/java/app/codeg/web/UrlNormalizer.java"
    )
    expect(urls).toContain('"?_frontend_reload=" + UUID.randomUUID()')
  })
})
