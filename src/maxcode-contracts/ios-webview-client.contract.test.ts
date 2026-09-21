import { describe, expect, it } from "vitest"
import { source, sourceExists } from "./contract-source"

const root = "ios-webview/MaxCode/"

describe("MaxCode iOS shell contract", () => {
  it("keeps the native connection chooser aligned with Android", () => {
    const androidStrings = source(
      "android-webview/app/src/main/res/values-zh-rCN/strings.xml"
    )
    const chooser = source(root + "ConnectionsViewController.swift")
    for (const key of [
      "setup_title_select",
      "setup_subtitle_select",
      "saved_connections_label",
      "tap_to_connect",
      "saved_hint",
    ]) {
      const text = androidStrings.match(
        new RegExp(`<string name="${key}">([^<]+)</string>`)
      )?.[1]
      expect(text, key).toBeTruthy()
      expect(chooser, key).toContain(text!)
    }
    const colors = source("android-webview/app/src/main/res/values/colors.xml")
    const theme = source(root + "ShellStyle.swift")
    for (const key of [
      "surface",
      "text_primary",
      "text_secondary",
      "divider",
      "surface_subtle",
    ]) {
      const hex = colors.match(
        new RegExp(`<color name="${key}">#([A-F0-9]{6})</color>`)
      )?.[1]
      expect(hex, key).toBeTruthy()
      expect(theme, key).toContain(`0x${hex}`)
    }
    expect(chooser).toContain('UIAction(title: "编辑"')
    expect(chooser).toContain('UIAction(title: "删除"')
    expect(source(root + "SceneDelegate.swift")).toContain(
      "prefersLargeTitles = false"
    )
  })

  it("opens the chooser on cold launch and keeps native workspace controls hidden", () => {
    const scene = source(root + "SceneDelegate.swift")
    expect(scene).toContain("rootViewController: ConnectionsViewController()")
    expect(scene).toContain("setNavigationBarHidden(true, animated: false)")
    expect(scene).not.toContain("WorkspaceViewController(")
    const chooser = source(root + "ConnectionsViewController.swift")
    expect(chooser).not.toContain("setNavigationBarHidden(false")
    const workspace = source(root + "WorkspaceViewController.swift")
    expect(workspace).not.toContain("UIBarButtonItem")
    expect(workspace).not.toContain("右上角刷新")
    expect(workspace).toContain("errorPanel.isHidden = true")
    expect(workspace).toContain('retry.setTitle("重新加载"')
    expect(workspace).toContain("popToRootViewController(animated: true)")
  })

  it("uses the scene lifecycle required by current iOS releases", () => {
    const plist = source(root + "Info.plist")
    expect(plist).toContain("UIApplicationSceneManifest")
    expect(plist).toContain("UIWindowSceneSessionRoleApplication")
    expect(plist).toContain("$(PRODUCT_MODULE_NAME).SceneDelegate")
    const scene = source(root + "SceneDelegate.swift")
    expect(scene).toContain("UIWindowSceneDelegate")
    expect(scene).toContain("UIWindow(windowScene: windowScene)")
    expect(source(root + "AppDelegate.swift")).not.toContain("UIWindow(frame:")
  })

  it("prevents focus zoom for native-shell form controls and rich editors", () => {
    const scripts = source(root + "Core/WebScripts.swift")
    expect(scripts).toContain("input, textarea, select,")
    expect(scripts).toContain('[contenteditable="true"]')
    expect(scripts).toContain('[contenteditable="plaintext-only"]')
    expect(scripts).toContain("font-size: max(16px, 1em) !important")
    expect(scripts).toContain("user-scalable=no")
    expect(scripts).toContain("minimum-scale=1, maximum-scale=1")
  })

  it("locks the shell to portrait and disables viewport scaling", () => {
    const plist = source(root + "Info.plist")
    expect(
      plist.match(/<string>UIInterfaceOrientationPortrait<\/string>/g)
    ).toHaveLength(2)
    expect(plist).not.toContain("UIInterfaceOrientationLandscape")
    expect(plist).not.toContain("UIInterfaceOrientationPortraitUpsideDown")
    expect(source(root + "AppDelegate.swift")).toContain(
      "supportedInterfaceOrientationsFor"
    )
    const workspace = source(root + "WorkspaceViewController.swift")
    expect(workspace).toContain("config.ignoresViewportScaleLimits = false")
    expect(workspace).toContain("pinchGestureRecognizer?.isEnabled = false")
    expect(workspace).toContain(
      "source: WebScripts.viewport, injectionTime: .atDocumentStart"
    )
  })

  it("reserves the bottom safe area once in the native container", () => {
    const scripts = source(root + "Core/WebScripts.swift")
    expect(scripts).toContain("viewport-fit=contain")
    expect(scripts).not.toContain("viewport-fit=cover")
    const native = source(root + "WorkspaceViewController.swift")
    expect(native).toContain("webView.scrollView.isScrollEnabled = false")
    expect(native).toContain(
      "scrollView.setContentOffset(.zero, animated: false)"
    )
    expect(source(root + "WorkspaceViewController.swift")).toContain(
      "UIResponder.keyboardWillHideNotification"
    )
    expect(source(root + "WorkspaceViewController.swift")).toContain(
      "keyboardBottom.isActive = false"
    )
    expect(source(root + "WorkspaceViewController.swift")).toContain(
      "restingBottom = webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)"
    )
    expect(source(root + "WorkspaceViewController.swift")).toContain(
      "webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)"
    )
  })

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
      "SceneDelegate.swift",
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
    expect(workspace).toContain(
      "webView.allowsBackForwardNavigationGestures = true"
    )
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
