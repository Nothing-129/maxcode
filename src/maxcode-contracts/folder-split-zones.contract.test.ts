import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

/**
 * ChatGPT 桌面端 1:1 复刻：ChatGPT 没有分屏，用户选择牺牲该功能（2026-09-08）。
 * 本契约钉住「分屏永久禁用」的四个不变量：
 *   1. selectIsSplit 恒为 false —— UI 永远走单窗格布局；
 *   2. hydration 把历史持久化的多组布局归一为单组（升级不炸、不留隐形标签）；
 *   3. splitTab / moveTabToGroup 是空操作 —— 布局无法再变成多组；
 *   4. openFolderInSplit 退化为在当前单组正常打开（保留旧调用兼容）。
 * 原「folder-bound tab splits」契约（左右分栏/文件夹分区）随功能一并退役。
 */
describe("MaxCode contract: split groups permanently disabled (ChatGPT 1:1)", () => {
  it("folder menus do not expose retired split actions", () => {
    const sidebar = source(
      "src/components/conversations/sidebar-conversation-list.tsx"
    )
    expect(sidebar).not.toContain("onOpenInSplit")
    expect(sidebar).not.toContain("openFolderInSplit")
    expect(sidebar).not.toContain("folderHeaderMenu.openInLeftSplit")
    expect(sidebar).not.toContain("folderHeaderMenu.openInRightSplit")
  })

  it("selectIsSplit is always false", () => {
    const store = source("src/stores/tab-store.ts")
    expect(store).toMatch(
      /export function selectIsSplit\(\): boolean \{\s*\n\s*return false\s*\n\}/
    )
  })

  it("hydration collapses any persisted multi-group layout into a single group", () => {
    const store = source("src/stores/tab-store.ts")
    expect(store).toContain("singleGroupLayout()")
    expect(store).toContain(
      'parsed.layout.type === "group" ? parsed.layout : singleGroupLayout()'
    )
  })

  it("splitTab and moveTabToGroup are no-ops", () => {
    const store = source("src/stores/tab-store.ts")
    const splitTabIdx = store.indexOf("splitTab: (tabId, direction, opts) => {")
    const splitTab = store.slice(splitTabIdx, splitTabIdx + 400)
    expect(splitTab).toContain("void tabId")
    expect(splitTab).not.toContain("splitGroup(")

    const moveTabIdx = store.indexOf(
      "moveTabToGroup: (tabId, targetGroupId, opts) => {"
    )
    const moveTab = store.slice(moveTabIdx, moveTabIdx + 300)
    expect(moveTab).toContain("void targetGroupId")
    expect(moveTab).not.toContain("groupOfTab(")
  })

  it("openFolderInSplit opens in the single group instead of splitting", () => {
    const store = source("src/stores/tab-store.ts")
    const fnIdx = store.indexOf(
      "openFolderInSplit: (folderId, workingDir, side) => {"
    )
    const fn = store.slice(fnIdx, fnIdx + 400)
    expect(fn).toContain("void side")
    expect(fn).toContain("openNewConversationTab(folderId, workingDir)")
    expect(fn).not.toContain("splitGroup(")
  })
})
