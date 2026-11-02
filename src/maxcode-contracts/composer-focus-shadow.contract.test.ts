import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

it("preserves Doubao resting and focused composer elevation", () => {
  const css = readFileSync("src/app/globals.css", "utf8")
  expect(css).toContain("0 8px 32px rgb(0 0 0 / 8%)")
  expect(css).toContain(".codeg-composer-chrome:focus-within")
  expect(css).toContain("border-color: rgb(0 102 255 / 30%)")
  expect(css).toContain("0 8px 24px rgb(95 178 255 / 17%)")
})
