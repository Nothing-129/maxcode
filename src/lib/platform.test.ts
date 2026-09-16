import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  desktop: false,
  openExternal: vi.fn(async () => {}),
  openPath: vi.fn(async () => {}),
  revealItemInDir: vi.fn(async () => {}),
}))

vi.mock("./electron", () => ({
  isElectron: () => mocks.desktop,
  getElectronBridge: () => (mocks.desktop ? mocks : null),
}))

import { openPath, openUrl, revealItemInDir } from "./platform"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.desktop = false
})

describe("native platform actions", () => {
  it("opens Electron external links through the preload bridge", async () => {
    mocks.desktop = true
    await openUrl("https://example.com/issues/1")
    expect(mocks.openExternal).toHaveBeenCalledWith(
      "https://example.com/issues/1"
    )
  })

  it("opens browser links without exposing the app as an opener", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    await openUrl("https://example.com/issues/1")
    expect(open).toHaveBeenCalledWith(
      "https://example.com/issues/1",
      "_blank",
      "noreferrer"
    )
    expect(mocks.openExternal).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it("opens and reveals filesystem paths only in Electron", async () => {
    await openPath("/repo/README.md")
    await revealItemInDir("/repo/README.md")
    expect(mocks.openPath).not.toHaveBeenCalled()
    expect(mocks.revealItemInDir).not.toHaveBeenCalled()
    mocks.desktop = true
    await openPath("/repo/README.md")
    await revealItemInDir("/repo/README.md")
    expect(mocks.openPath).toHaveBeenCalledWith("/repo/README.md")
    expect(mocks.revealItemInDir).toHaveBeenCalledWith("/repo/README.md")
  })
})
