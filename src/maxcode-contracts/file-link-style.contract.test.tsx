import { render } from "@testing-library/react"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { ReferenceBadge } from "@/components/chat/composer/badges/reference-badge"
import { FileTypeIcon } from "@/components/chat/composer/badges/file-type-icon"
import { resolveFileIcon, fileIconSources } from "@/lib/file-icon"
import assets from "@/lib/file-icon-assets.json"
import { source } from "./contract-source"

const data = {
  refType: "file" as const,
  id: "/tmp/app.dmg",
  label: "打开新版安装包",
  uri: null,
  meta: null,
}

describe("transcript file link style", () => {
  it("inherits body typography, uses local library artwork and expands to available width", () => {
    const { container, getByRole } = render(
      <ReferenceBadge data={data} appearance="file-link" />
    )
    expect(getByRole("img")).toHaveClass(
      "text-[1em]",
      "font-[inherit]",
      "text-[#2456a6]",
      "max-w-full",
      "items-start"
    )
    expect(getByRole("img")).not.toHaveClass("max-w-[18rem]")
    expect(container.querySelector("[data-file-icon]")).toHaveAttribute(
      "data-file-icon",
      "file-type-binary"
    )
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/file-icons/file-type-binary.svg"
    )
  })
  it("wraps long filenames on mobile without truncation", () => {
    const label = "正式库_指定签单人已签单线索_" + "abcdef".repeat(30) + ".xlsx"
    const { getByText } = render(
      <ReferenceBadge data={{ ...data, label }} appearance="file-link" />
    )
    expect(getByText(label)).toHaveClass(
      "min-w-0",
      "whitespace-normal",
      "[overflow-wrap:anywhere]"
    )
    expect(getByText(label)).not.toHaveClass("truncate")
  })
  it.each([
    ["report.xlsx", "excel"],
    ["report.csv", "excel"],
    ["report.docx", "word"],
    ["slides.pptx", "powerpoint"],
    ["report.pdf", "pdf2"],
    ["readme.md", "markdown"],
    ["page.mdx", "mdx"],
    ["index.html", "html"],
    ["app.css", "css"],
    ["app.scss", "sass"],
    ["app.js", "js-official"],
    ["app.ts", "typescript-official"],
    ["types.d.ts", "typescriptdef-official"],
    ["app.jsx", "reactjs"],
    ["app.tsx", "reactts"],
    ["config.json", "json"],
    ["config.json5", "json5"],
    ["config.yml", "yaml"],
    ["config.toml", "toml"],
    ["feed.xml", "xml"],
    ["main.py", "python"],
    ["main.rs", "rust"],
    ["main.go", "go"],
    ["Main.java", "java"],
    ["main.c", "c"],
    ["main.cpp", "cpp"],
    ["main.cs", "csharp"],
    ["run.sh", "shell"],
    ["run.ps1", "powershell"],
    ["app.vue", "vue"],
    ["app.svelte", "svelte"],
    ["query.sql", "sql"],
    ["data.sqlite", "sqlite"],
    ["photo.png", "image"],
    ["drawing.svg", "svg"],
    ["art.psd", "photoshop"],
    ["backup.tar.gz", "zip"],
    ["music.mp3", "audio"],
    ["movie.mp4", "video"],
    ["font.woff2", "font"],
    ["readme.txt", "text"],
    ["app.log", "log"],
    ["app.dmg", "binary"],
    ["package.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["Dockerfile", "docker"],
    ["Dockerfile.dev", "docker"],
    ["compose.yaml", "docker"],
    [".gitignore", "git"],
    [".env.staging", "dotenv"],
    ["LICENSE", "license"],
    ["next.config.ts", "next"],
    ["vite.config.ts", "vite"],
  ])(
    "selects dedicated library artwork for %s from the actual path",
    (name, icon) => {
      const { container } = render(
        <ReferenceBadge
          data={{ ...data, id: `/tmp/${name}`, label: "下载文件.txt" }}
          appearance="file-link"
        />
      )
      expect(container.querySelector("[data-file-icon]")).toHaveAttribute(
        "data-file-icon",
        `file-type-${icon}`
      )
      expect(container.querySelector("[data-file-icon]")).toHaveAttribute(
        "aria-hidden",
        "true"
      )
    }
  )
  it.each([
    ["C:\\exports\\REPORT.PDF", "file-type-pdf2"],
    ["/tmp/report%2Exlsx?download=1#page", "file-type-excel"],
    ["/tmp/code.tsx:42:3", "file-type-reactts"],
    ["/tmp/%invalid", "default-file"],
    ["/tmp/unknown.extension", "default-file"],
    ["/tmp/README", "default-file"],
  ])("handles normalized paths and safe fallbacks for %s", (path, icon) => {
    expect(resolveFileIcon(path)).toBe(icon)
  })
  it("uses folder artwork even when the folder name has a file extension", () => {
    expect(resolveFileIcon("/tmp/archive.pdf", true)).toBe("default-folder")
  })
  it("ships light/dark variants locally for icons with theme-specific artwork", () => {
    const { container } = render(<FileTypeIcon path="page.mdx" />)
    const images = container.querySelectorAll("img")
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute(
      "src",
      "/file-icons/file-type-light-mdx.svg"
    )
    expect(images[0]).toHaveClass("dark:hidden")
    expect(images[1]).toHaveClass("hidden", "dark:block")
    for (const icon of Object.keys(assets) as (keyof typeof assets)[]) {
      for (const src of Object.values(fileIconSources(icon))) {
        const path = resolve(process.cwd(), `public${src}`)
        expect(existsSync(path), src).toBe(true)
        expect(readFileSync(path, "utf8")).toContain("<svg")
      }
    }
    expect(source("public/file-icons/LICENSE")).toContain("MIT License")
  })
  it("retains compact composer badges", () => {
    const { container, getByRole } = render(<ReferenceBadge data={data} />)
    expect(getByRole("img")).toHaveClass(
      "text-[0.85em]",
      "text-blue-700",
      "max-w-[18rem]"
    )
    expect(container.querySelector("svg")).toHaveClass("lucide-file-text")
  })
  it("applies presentation to local paths and codeg file references", () => {
    expect(
      source("src/components/ai-elements/markdown-link.tsx").match(
        /data=\{fileData\} appearance="file-link"/g
      )
    ).toHaveLength(2)
  })
})
