import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: public share settings layout", () => {
  it("keeps the public URL in a separate section below local service controls", () => {
    const settings = source("src/components/settings/web-service-settings.tsx")
    const section = settings.indexOf("<section\n")
    expect(section).toBeGreaterThan(settings.indexOf("<AddressBar"))
    expect(section).toBeGreaterThan(settings.indexOf('t("autoStart")'))
    expect(settings.slice(section)).toContain(
      'className="space-y-2 border-t pt-6"'
    )
    expect(settings.slice(section)).toContain('htmlFor="public-share-url"')
    expect(settings.slice(section)).toContain("value={publicShareUrl}")
    expect(settings.slice(section)).toContain('t("publicShareUrlHint")')
  })
})
