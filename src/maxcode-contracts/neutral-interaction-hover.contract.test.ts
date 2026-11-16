import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory()
      ? componentFiles(path)
      : path.endsWith(".tsx") && !path.includes(".test.")
        ? [path]
        : []
  })
}

it("keeps theme accents out of transient hover and menu highlight backgrounds", () => {
  const violations = componentFiles("src/components").flatMap((path) => {
    const text = readFileSync(path, "utf8")
    const tokens = text.match(/[^\s"'`]+/g) ?? []
    return tokens
      .filter(
        (token) =>
          /(?:hover|focus|highlighted)/.test(token) &&
          /:bg-(?:accent|sidebar-accent)(?:\/\d+)?$/.test(token)
      )
      .map((token) => `${path}: ${token}`)
  })
  expect(violations).toEqual([])
})

it("provides explicit neutral colors for light and dark themes", () => {
  const css = readFileSync("src/app/neutral-hover.css", "utf8")
  expect(css).toContain("--interaction-hover: #f2f2f2")
  expect(css).toContain("--interaction-hover: #303030")
})
