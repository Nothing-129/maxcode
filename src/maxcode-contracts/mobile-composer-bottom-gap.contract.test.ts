import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("phone composer bottom spacing", () => {
  it("reserves the browser safe area once at the workspace boundary", () => {
    const workspace = source("src/app/workspace/layout.tsx")
    const composer = source("src/components/chat/chat-input.tsx")
    expect(workspace).toContain("pb-[env(safe-area-inset-bottom)]")
    expect(composer).not.toContain("env(safe-area-inset-bottom)")
    expect(composer).toContain('flush ? "pb-1" : "px-4 pb-2 md:pb-3"')
  })

  it("lets the Android shell own bottom navigation-bar and keyboard avoidance", () => {
    const root = "android-webview/app/src/"
    const activity = source(`${root}main/java/app/codeg/web/MainActivity.java`)
    const bootstrap = source(
      `${root}main/java/app/codeg/web/WebBootstrapScript.java`
    )
    // Native layout still protects the navigation bar and open IME. Removing
    // web padding must not mean letting the keyboard cover the composer.
    expect(activity).toContain("WindowInsets.Type.systemBars()")
    expect(activity).toContain("WindowInsets.Type.ime()")
    expect(activity).toContain(
      "view.setPadding(left, browserImmersive ? 0 : top, right, bottom)"
    )
    // Apply to current and legacy server shells on every Android device, not
    // just the Oppo-specific top-inset workaround. Browsers get no injection.
    expect(bootstrap).toContain(
      '"div.fixed.inset-0.flex.flex-col.overflow-hidden.bg-background.text-foreground,"'
    )
    expect(bootstrap).toContain(
      '"div.h-screen.flex.flex-col.overflow-hidden.bg-background."'
    )
    expect(bootstrap).toContain(
      '"text-foreground{box-sizing:border-box;padding-bottom:0!important;"'
    )
    expect(bootstrap).toContain("+ (protectPageShells")
    expect(activity).toContain("WebBootstrapScript.setAndroidStatusBarInset(")
    expect(
      source(`${root}test/java/app/codeg/web/WebBootstrapScriptTest.java`)
    ).toContain("nativeBottomSafeAreaIsNotRepeatedByEitherPageShell")
  })
})
