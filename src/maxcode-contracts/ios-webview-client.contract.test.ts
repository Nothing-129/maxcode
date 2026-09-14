import { describe, expect, it } from "vitest"
import { source, sourceExists } from "./contract-source"

const root = "ios-webview/MaxCode/"

describe("MaxCode iOS shell contract", () => {
  it("keeps personal automatic signing across project regeneration", () => {
    const project = source("ios-webview/MaxCode.xcodeproj/project.pbxproj")
    expect(project).toContain("Signing.xcconfig")
    expect(project.match(/baseConfigurationReference = /g)).toHaveLength(2)
    const signing = source("ios-webview/Signing.xcconfig")
    expect(signing).toContain("CODE_SIGN_STYLE = Automatic")
    expect(signing).toContain('#include? "Signing.local.xcconfig"')
    expect(source("ios-webview/.gitignore")).toContain("Signing.local.xcconfig")
  })
  it("keeps an independent iPhone and iPad shell with the shared web workspace", () => {
    const project = source("ios-webview/MaxCode.xcodeproj/project.pbxproj")
    expect(project).toContain('IPHONEOS_DEPLOYMENT_TARGET = "16.0"')
    expect(project).toContain('TARGETED_DEVICE_FAMILY = "1,2"')
    for (const file of [
      "AppDelegate.swift",
      "ConnectionsViewController.swift",
      "ConnectionEditorViewController.swift",
      "WorkspaceViewController.swift",
      "ConnectionStore.swift",
      "Core/Connection.swift",
      "Core/ServerHealthChecker.swift",
      "Core/WebScripts.swift",
    ]) {
      expect(sourceExists(root + file), file).toBe(true)
      expect(project, file).toContain(`MaxCode/${file}`)
    }
    expect(source(root + "Core/Connection.swift")).toContain(
      'parts.path = "/workspace"'
    )
    expect(source(root + "Core/Connection.swift")).toContain(
      'URLQueryItem(name: "_frontend_reload", value: UUID().uuidString)'
    )
  })

  it("stores connections atomically in device-only Keychain and isolates web sessions", () => {
    const storage = source(root + "ConnectionStore.swift")
    expect(storage).toContain("SecItemCopyMatching")
    expect(storage).toContain("SecItemUpdate")
    expect(storage).toContain("kSecAttrAccessibleWhenUnlockedThisDeviceOnly")
    expect(storage).not.toContain("UserDefaults.standard")
    const list = source(root + "ConnectionsViewController.swift")
    expect(list).toContain("confirmDelete(connection)")
    expect(list).toContain("try self.store.save(remaining)")
    const editor = source(root + "ConnectionEditorViewController.swift")
    expect(
      editor.indexOf("ServerHealthChecker.check(connection)")
    ).toBeLessThan(editor.indexOf("ConnectionStore().save(updated)"))
    expect(editor).toContain("try Task.checkCancellation()")
    expect(source(root + "WorkspaceViewController.swift")).toContain(
      "config.websiteDataStore = .nonPersistent()"
    )
  })

  it("validates credentials before opening and injects them only in the selected origin", () => {
    const health = source(root + "Core/ServerHealthChecker.swift")
    expect(health).toContain('request.httpMethod = "POST"')
    expect(health).toContain('forHTTPHeaderField: "Authorization"')
    expect(health).toContain("completionHandler(nil)")
    expect(health).not.toContain("URLCredential(trust:")
    const list = source(root + "ConnectionsViewController.swift")
    expect(list.indexOf("ServerHealthChecker.check(connection)")).toBeLessThan(
      list.indexOf("pushViewController(WorkspaceViewController")
    )
    const scripts = source(root + "Core/WebScripts.swift")
    expect(scripts).toContain("window.top !== window")
    expect(scripts).toContain("window.location.origin !==")
    expect(scripts).toContain("JSONEncoder().encode(value)")
    expect(scripts).toContain("localStorage.setItem('codeg_token'")
    const workspace = source(root + "WorkspaceViewController.swift")
    expect(workspace).toContain(
      "injectionTime: .atDocumentStart, forMainFrameOnly: true"
    )
    expect(workspace).toContain("ServerURL.sameOrigin(connection.baseURL, url)")
    expect(workspace).not.toContain("URLCredential(trust:")
  })

  it("preserves native keyboard avoidance, page navigation and foreground recovery", () => {
    const workspace = source(root + "WorkspaceViewController.swift")
    expect(workspace).toContain("view.keyboardLayoutGuide.topAnchor")
    expect(workspace).toContain("view.safeAreaLayoutGuide.topAnchor")
    expect(workspace).toContain("UIApplication.didBecomeActiveNotification")
    expect(workspace).toContain("monitor.pathUpdateHandler")
    expect(workspace).toContain("webView.goBack()")
    expect(workspace).toContain("webView.load(navigationAction.request)")
    expect(workspace).toContain("UIApplication.shared.open(url)")
    expect(workspace).toContain("runJavaScriptConfirmPanelWithMessage")
    expect(workspace).toContain("webViewWebContentProcessDidTerminate")
    const plist = source(root + "Info.plist")
    expect(plist).toContain("NSLocalNetworkUsageDescription")
    expect(plist).toContain("NSCameraUsageDescription")
    expect(sourceExists("ios-webview/scripts/test-core.sh")).toBe(true)
    expect(sourceExists("ios-webview/Tests/ShellCoreTests.swift")).toBe(true)
  })
})
