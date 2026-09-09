import {
  COMPOSER_CHROME_BOX_CLASS,
  COMPOSER_CHROME_SHADOW_CLASS,
  COMPOSER_CHROME_SURFACE_CLASS,
} from "./composer-chrome"

describe("composer chrome", () => {
  it("is always-on selected chrome, not a click-only focus ring", () => {
    expect(COMPOSER_CHROME_BOX_CLASS).toContain("codeg-composer-chrome")
    // Retain the 20px radius with a softer outline in both themes.
    expect(COMPOSER_CHROME_BOX_CLASS).toContain("rounded-[1.25rem]")
    expect(COMPOSER_CHROME_BOX_CLASS).toContain("border-black/[0.06]")
    expect(COMPOSER_CHROME_BOX_CLASS).toContain("dark:border-white/[0.08]")
    expect(COMPOSER_CHROME_BOX_CLASS).not.toContain("focus-within")
    expect(COMPOSER_CHROME_SHADOW_CLASS).toContain("shadow-[")
    expect(COMPOSER_CHROME_SURFACE_CLASS).toContain("ws-transparent-bg")
  })
})
