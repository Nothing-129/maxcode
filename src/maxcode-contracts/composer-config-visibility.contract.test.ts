import { describe, expect, it } from "vitest"
import {
  showComposerConfigInline,
  showComposerConfigInSettings,
  secondaryComposerConfig,
} from "@/lib/composer-config-visibility"
import type { SessionConfigOptionInfo } from "@/lib/types"
import { readFileSync } from "node:fs"
function option(id: string, value: string | boolean): SessionConfigOptionInfo {
  return {
    id,
    name: id,
    kind:
      typeof value === "boolean"
        ? { type: "boolean", current_value: value }
        : { type: "select", current_value: value, options: [], groups: [] },
  }
}
describe("composer secondary configuration", () => {
  it("hides defaults but exposes active states from current agent values", () => {
    expect(
      showComposerConfigInline(option("collaboration_mode", "default"))
    ).toBe(false)
    expect(showComposerConfigInline(option("collaboration_mode", "plan"))).toBe(
      false
    )
    for (const id of ["fast-mode", "fast_mode"]) {
      for (const off of [false, "off", "false"])
        expect(showComposerConfigInline(option(id, off))).toBe(false)
      for (const on of [true, "on", "true"])
        expect(showComposerConfigInline(option(id, on))).toBe(false)
    }
  })
  it("keeps model, effort, permissions and unknown options visible even with default/off values", () => {
    for (const id of ["model", "reasoning_effort", "mode", "custom"]) {
      expect(secondaryComposerConfig(option(id, "default"))).toBeNull()
      expect(showComposerConfigInline(option(id, "off"))).toBe(true)
    }
    expect(
      showComposerConfigInline(option("collaboration_mode", "future-mode"))
    ).toBe(true)
  })
  it("shares setting visibility across narrow and wide composers", () => {
    for (const value of ["default", "plan", "future-mode"]) {
      const config = option("collaboration_mode", value)
      expect(showComposerConfigInSettings(config, true)).toBe(
        showComposerConfigInline(config)
      )
    }
    for (const id of ["model", "reasoning_effort", "mode", "custom"])
      expect(showComposerConfigInSettings(option(id, "default"), true)).toBe(
        true
      )
    for (const id of ["fast-mode", "fast_mode"]) {
      expect(showComposerConfigInSettings(option(id, "on"), true)).toBe(false)
      expect(showComposerConfigInSettings(option(id, "on"), false)).toBe(true)
    }
  })
  it("preserves agent titles for model, effort and permission settings", () => {
    const source = readFileSync("src/components/chat/message-input.tsx", "utf8")
    const titleResolver = source.slice(
      source.indexOf("const configTitle ="),
      source.indexOf("const renderInlineConfigOption =")
    )
    expect(titleResolver).toContain("return option.name")
    for (const key of ["model", "effort", "permission"]) {
      expect(titleResolver).not.toContain(`t("composerConfig.${key}")`)
    }
  })
  it("keeps narrow settings wired to shared visibility, labels and readonly protections", () => {
    const source = readFileSync("src/components/chat/message-input.tsx", "utf8")
    expect(source).toContain("settings={modelSettings}")
    expect(source).toContain(
      "showComposerConfigInSettings(option, hasModelOption)"
    )
    expect(source).toContain("title: configTitle(option)")
    expect(source).toContain(
      "const hasAnySelector = modelSettings.length > 0 || showSelectorsLoading"
    )
    expect(source).toContain("collaboration={")
    expect(
      readFileSync("src/components/chat/composer/composer-add-menu.tsx", "utf8")
    ).toContain('{t("composerConfig.collaboration")}')
    const menu = readFileSync(
      "src/components/chat/composer/composer-add-menu.tsx",
      "utf8"
    )
    expect(menu.indexOf('{t("attachLocalUpload")}')).toBeLessThan(
      menu.indexOf('{t("attachServerFile")}')
    )
    expect(menu.indexOf('{t("attachServerFile")}')).toBeLessThan(
      menu.indexOf('{t("quickMessages")}')
    )
    expect(menu.indexOf('{t("quickMessages")}')).toBeLessThan(
      menu.indexOf('{t("slashCommands")}')
    )
    expect(menu.indexOf('{t("slashCommands")}')).toBeLessThan(
      menu.indexOf('{t("composerConfig.collaboration")}')
    )
    expect(menu).not.toContain("DropdownMenuSeparator")
    expect(source).toContain(
      "flex shrink-0 items-center justify-between gap-1 px-2 pb-2"
    )
    expect(source).toContain(
      "maxcode-composer-actions flex min-h-8 shrink-0 items-center"
    )
    expect(source).not.toContain("items-end")
    expect(source).toContain("inert={configOptionsReadOnly}")
    expect(source).toContain(".filter(showComposerConfigInline)")
    expect(source).toContain("title={configTitle(option)}")
    expect(source).not.toContain("{configTitle(option)}</span>")
  })
})
