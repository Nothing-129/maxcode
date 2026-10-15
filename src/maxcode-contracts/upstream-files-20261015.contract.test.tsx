import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"
import { FileWorkspaceHeader } from "@/components/files/file-workspace-header"
import { KeptOfficePreviews } from "@/components/files/kept-office-previews"
import { isPdfFile, shouldOpenWithSystemApp } from "@/lib/language-detect"
import { decodePdfDataUrl, pdfDocumentParams } from "@/lib/pdfjs"
import { loadedCacheableAssets } from "@/lib/service-worker"

const mocks = vi.hoisted(() => ({
  tabs: [] as FileWorkspaceTab[],
  active: null as FileWorkspaceTab | null,
  folders: [{ id: 1, path: "/repo" }],
  download: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  renew: vi.fn(),
  toggle: vi.fn(),
  openPath: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/contexts/workspace-context", () => ({
  useWorkspaceFileTabs: () => ({
    fileTabs: mocks.tabs,
    activeFileTab: mocks.active,
    activeFileTabId: mocks.active?.id ?? null,
    previewFileTabIds: new Set<string>(),
  }),
  useWorkspaceActions: () => ({ toggleFileTabPreview: mocks.toggle }),
}))
vi.mock("@/components/files/file-path-breadcrumb", () => ({
  FilePathBreadcrumb: ({ fileName }: { fileName: string }) => (
    <span>{fileName}</span>
  ),
}))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: (select: (state: unknown) => unknown) =>
    select({ allFolders: mocks.folders }),
}))
vi.mock("@/lib/platform", () => ({ openPath: mocks.openPath }))
vi.mock("@/lib/transport", () => ({
  getServerBaseUrl: () => "http://127.0.0.1:3210",
}))
vi.mock("@/lib/api", () => ({
  downloadWorkspaceFile: mocks.download,
  isWorkspaceFileApiAvailable: () => true,
  WORKSPACE_DOWNLOAD_CANCELLED: "cancelled",
  startOfficeWatch: mocks.start,
  stopOfficeWatch: mocks.stop,
  renewOfficeWatch: mocks.renew,
}))
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

function file(path: string, language = "plaintext"): FileWorkspaceTab {
  return {
    id: `file:${path}`,
    kind: "file",
    folderId: null,
    title: path.split("/").pop()!,
    description: path,
    path,
    content: "",
    language,
    loading: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tabs = []
  mocks.active = null
  mocks.download.mockResolvedValue({ status: "started" })
  mocks.start.mockResolvedValue({
    port: 26315,
    cap: "watch-token",
    hold: "page-hold",
  })
  mocks.stop.mockResolvedValue(undefined)
  mocks.renew.mockResolvedValue(true)
  mocks.openPath.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe("MaxCode file previews retain the Electron and shared-server contracts", () => {
  it("keeps PDFs in the app while other desktop artifacts still use the system", () => {
    expect(isPdfFile("/repo/报告.PDF")).toBe(true)
    expect(shouldOpenWithSystemApp("/repo/报告.PDF")).toBe(false)
    for (const path of [
      "/tmp/MaxCode.dmg",
      "/tmp/MaxCode.app",
      "/tmp/build.zip",
      "/tmp/movie.mp4",
    ]) {
      expect(shouldOpenWithSystemApp(path)).toBe(true)
    }
    expect(decodePdfDataUrl("data:application/pdf;base64,JVBERi0x")).toEqual(
      new Uint8Array([37, 80, 68, 70, 45, 49])
    )
    expect(decodePdfDataUrl("unableLoadContent")).toBeNull()
  })

  it("loads PDF support assets from this app origin, including worker decoders", () => {
    const params = pdfDocumentParams(new Uint8Array([37]))
    expect(params.cMapUrl).toBe(new URL("/pdfjs/cmaps/", document.baseURI).href)
    expect(params.standardFontDataUrl).toBe(
      new URL("/pdfjs/standard_fonts/", document.baseURI).href
    )
    expect(params.wasmUrl).toBe(new URL("/pdfjs/wasm/", document.baseURI).href)
    expect(params.iccUrl).toBe(new URL("/pdfjs/iccs/", document.baseURI).href)
  })

  it("lets a newly controlling PWA worker cache PDF support without caching document or Office API bytes", () => {
    const origin = window.location.origin
    const assets = [
      `${origin}/pdfjs/pdf.worker.min.mjs?v=6.4.299`,
      `${origin}/pdfjs/cmaps/UniGB-UCS2-H.bcmap`,
      `${origin}/pdfjs/standard_fonts/FoxitSerif.pfb`,
      `${origin}/pdfjs/wasm/openjpeg.wasm`,
      `${origin}/pdfjs/iccs/CGATS001Compat-v2-micro.icc`,
    ]
    const resources = vi
      .spyOn(performance, "getEntriesByType")
      .mockReturnValue(
        [
          ...assets,
          `${origin}/api/read_file_base64`,
          `${origin}/api/office-watch-proxy/26315/?cap=private`,
          "https://elsewhere.example/pdfjs/pdf.worker.min.mjs",
        ].map((name) => ({ name }) as PerformanceEntry)
      )
    try {
      expect(loadedCacheableAssets()).toEqual(assets)
    } finally {
      resources.mockRestore()
    }
  })

  it("downloads a nested file relative to its owning workspace without extra success noise", async () => {
    mocks.active = file("/repo/docs/report.pdf", "pdf")
    render(<FileWorkspaceHeader />)
    fireEvent.click(screen.getByRole("button", { name: "download" }))
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith(
        "/repo",
        "docs/report.pdf",
        "report.pdf"
      )
    )
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.openPath).not.toHaveBeenCalled()
  })

  it("downloads an agent output outside registered folders through its own directory", async () => {
    mocks.active = file("/tmp/generated/report.docx", "office")
    render(<FileWorkspaceHeader />)
    fireEvent.click(screen.getByRole("button", { name: "download" }))
    await waitFor(() =>
      expect(mocks.download).toHaveBeenCalledWith(
        "/tmp/generated",
        "report.docx",
        "report.docx"
      )
    )
  })

  it("does not treat an external-conflict diff as a downloadable file", () => {
    mocks.active = { ...file("/repo/a.ts"), kind: "rich-diff" }
    render(<FileWorkspaceHeader />)
    expect(screen.queryByRole("button", { name: "download" })).toBeNull()
  })

  it("keeps existing HTML preview and system-open actions alongside download", () => {
    mocks.active = file("/repo/index.html", "html")
    render(<FileWorkspaceHeader />)
    expect(screen.getAllByRole("button", { name: "preview" })).toHaveLength(2)
    expect(screen.getByRole("button", { name: "download" })).toBeVisible()
  })

  it("keeps an opaque HTTP Office frame across tab changes and releases its own hold on close", async () => {
    const office = file("/repo/report.docx", "office")
    const text = file("/repo/readme.md", "markdown")
    mocks.tabs = [office, text]
    mocks.active = office
    const { rerender } = render(<KeptOfficePreviews />)
    const frame = await screen.findByTitle("officePreviewTitle")
    expect(frame).toHaveAttribute(
      "src",
      "http://127.0.0.1:3210/api/office-watch-proxy/26315/?cap=watch-token"
    )
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-popups allow-forms"
    )
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer")
    mocks.active = text
    rerender(<KeptOfficePreviews />)
    expect(screen.getByTitle("officePreviewTitle")).toBe(frame)
    expect(frame.closest("[inert]")).not.toBeNull()
    expect(mocks.stop).not.toHaveBeenCalled()
    mocks.active = office
    rerender(<KeptOfficePreviews />)
    await waitFor(() =>
      expect(mocks.renew).toHaveBeenCalledWith(
        "/repo",
        "report.docx",
        "watch-token",
        "page-hold"
      )
    )
    expect(mocks.start).toHaveBeenCalledTimes(1)
    mocks.tabs = [text]
    mocks.active = text
    rerender(<KeptOfficePreviews />)
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    expect(mocks.stop).toHaveBeenCalledWith(
      "/repo",
      "report.docx",
      "watch-token",
      "page-hold"
    )
  })
})
