import { describe, expect, it, vi } from "vitest"
import { source } from "./contract-source"
import { serviceWorkerUrl } from "@/lib/service-worker"

describe("MaxCode contract: selected upstream platform updates", () => {
  it("isolates offline caches per frontend build rather than app release", () => {
    vi.stubEnv("NEXT_PUBLIC_FRONTEND_BUILD_ID", "first-build")
    expect(serviceWorkerUrl()).toBe("/sw.js?v=first-build")
    vi.stubEnv("NEXT_PUBLIC_FRONTEND_BUILD_ID", "second-build")
    expect(serviceWorkerUrl()).toBe("/sw.js?v=second-build")
    vi.unstubAllEnvs()
    expect(source("src/components/pwa-register.tsx")).toContain(
      "registerAppServiceWorker()"
    )
    expect(source("src/lib/service-worker.ts")).toContain(
      "if (isElectron()) return false"
    )
    expect(source("public/sw.js")).toContain('"/manifest.webmanifest"')
  })

  it("keeps mobile updates live and independently closes every existing viewer", () => {
    expect(
      source("src/components/layout/mobile-frontend-refresh.tsx")
    ).toContain('fetch("/frontend-version.json"')
    expect(source("src/app/workspace/layout.tsx")).toContain(
      "isConversations && !showConversation"
    )
    for (const path of [
      "src/components/files/file-viewer-drawer.tsx",
      "src/components/message/subagent-session-dialog.tsx",
      "src/components/message/sub-agent-session-dialog.tsx",
    ]) {
      expect(source(path), path).toContain(
        "useHistoryBackDismiss(open, () => onOpenChange(false))"
      )
    }
    expect(
      source(
        "android-webview/app/src/main/java/app/codeg/web/MainActivity.java"
      )
    ).toContain("webView.goBack()")
    expect(
      source("ios-webview/MaxCode/WorkspaceViewController.swift")
    ).toContain("webView.allowsBackForwardNavigationGestures = true")
  })

  it("uses the maintained catalog for provider-grouped delegation defaults", () => {
    const panel = source(
      "src/components/settings/delegation-agent-defaults.tsx"
    )
    expect(panel).toContain("const agentTypes = MAINTAINED_AGENT_TYPES")
    expect(panel).toContain("modelListGroups(option)")
    expect(panel).toContain("agentDefaultHintLabel(option, agentDefault)")
  })
})
