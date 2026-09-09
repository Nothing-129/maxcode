import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: subtle panel dividers", () => {
  it("keeps hover and drag lines thin while preserving the pointer target", () => {
    const handle = source("src/components/ui/resizable.tsx")
    expect(handle).toContain("[--resize-handle-thickness:1px]")
    for (const state of ["hover", "drag"]) {
      expect(handle).toContain(
        `data-[resize-handle-state=${state}]:[--resize-handle-thickness:2px]`
      )
    }
    expect(handle).toContain("after:w-3")
    expect(handle).toContain("data-[panel-group-direction=vertical]:after:h-3")
    expect(handle).toContain("before:pointer-events-none")
  })
})
