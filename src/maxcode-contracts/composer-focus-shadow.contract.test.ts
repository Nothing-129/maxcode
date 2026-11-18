import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

it("keeps resting composer elevation unchanged on focus", () => {
  const css = readFileSync("src/app/globals.css", "utf8")
  expect(css).toContain("0 8px 32px rgb(0 0 0 / 8%)")
  expect(css).not.toContain(".codeg-composer-chrome:focus-within")
  expect(css).not.toContain("border-color: rgb(0 102 255 / 30%)")
  expect(css).not.toContain("0 8px 24px rgb(95 178 255 / 17%)")
})
