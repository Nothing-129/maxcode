import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  loadOfficeAutoPreview,
  saveOfficeAutoPreview,
  useOfficeAutoPreview,
} from "@/lib/office-preview-prefs"

describe("Office auto-preview requires a new manual opt-in", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it.each([null, "true", "false"])(
    "starts disabled with legacy preference %s",
    (legacy) => {
      if (legacy !== null) {
        localStorage.setItem("workspace:office-auto-preview", legacy)
      }
      expect(loadOfficeAutoPreview()).toBe(false)
    }
  )

  it("preserves a manual opt-in across remounts and reacts to disabling", () => {
    const first = renderHook(useOfficeAutoPreview)
    expect(first.result.current).toBe(false)
    act(() => saveOfficeAutoPreview(true))
    expect(first.result.current).toBe(true)
    first.unmount()

    const reopened = renderHook(useOfficeAutoPreview)
    expect(reopened.result.current).toBe(true)
    act(() => saveOfficeAutoPreview(false))
    expect(reopened.result.current).toBe(false)
    expect(loadOfficeAutoPreview()).toBe(false)
  })

  it("stays disabled when storage cannot be read", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Storage unavailable")
      })
    try {
      expect(loadOfficeAutoPreview()).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it("reacts to a manual opt-in from another window", () => {
    const { result } = renderHook(useOfficeAutoPreview)
    act(() => {
      localStorage.setItem("workspace:office-auto-preview:v2", "true")
      window.dispatchEvent(new StorageEvent("storage"))
    })
    expect(result.current).toBe(true)
  })
})
