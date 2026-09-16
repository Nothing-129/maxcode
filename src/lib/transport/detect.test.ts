import { afterEach, describe, expect, it, vi } from "vitest"
import { detectEnvironment } from "./detect"

afterEach(() => vi.unstubAllGlobals())

describe("detectEnvironment", () => {
  it("defaults to browser transport without a preload bridge", () => {
    expect(detectEnvironment()).toBe("web")
  })

  it("detects the Electron preload bridge", () => {
    vi.stubGlobal("window", { maxcodeElectron: {} })
    expect(detectEnvironment()).toBe("electron")
  })

  it("is safe during static prerender", () => {
    vi.stubGlobal("window", undefined)
    expect(detectEnvironment()).toBe("web")
  })
})
