import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = (name: string) =>
  readFileSync(
    `android-webview/app/src/main/java/app/codeg/web/${name}.java`,
    "utf8"
  )

describe("Android direct web links", () => {
  it("saves locally without health checks or requiring a token", () => {
    const activity = source("MainActivity")
    expect(activity).not.toContain("healthChecker")
    expect(activity).not.toContain("error_token_required")
    expect(activity).toContain("configStore.upsertAndActivate(config)")
    expect(activity).toContain(
      "bootstrapPending = UrlNormalizer.shouldBootstrap(config)"
    )
    expect(activity).toContain(": config.baseUrl());")
  })

  it("reserves native status-bar space for generic pages instead of injecting MaxCode CSS", () => {
    const activity = source("MainActivity")
    expect(activity).toContain(
      "setImmersiveStatusBar(UrlNormalizer.shouldBootstrap(config))"
    )
    expect(activity).toContain(
      "view.setPadding(left, browserImmersive ? 0 : top, right, bottom)"
    )
    expect(activity).toContain(
      "if (!browserImmersive || activeConfig == null || target == null) return"
    )
  })

  it("preserves encoded paths, query and fragment, isolating bootstrap to token-bearing roots", () => {
    const normalizer = source("UrlNormalizer")
    expect(normalizer).toContain("uri.getRawPath()")
    expect(normalizer).toContain('"?" + uri.getRawQuery()')
    expect(normalizer).toContain('"#" + uri.getRawFragment()')
    expect(normalizer).toContain("!config.token().isEmpty()")
    expect(normalizer).toContain(
      "normalize(config.baseUrl()).equals(origin(config.baseUrl()))"
    )
    expect(normalizer).not.toContain("server must be at the URL root")
  })
})
