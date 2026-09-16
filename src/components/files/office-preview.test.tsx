import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }))
vi.mock("@/lib/api", () => ({
  startOfficeWatch: vi.fn(),
  stopOfficeWatch: vi.fn(),
}))
vi.mock("@/lib/transport", () => ({
  getServerBaseUrl: vi.fn(),
}))

import { startOfficeWatch, stopOfficeWatch } from "@/lib/api"
import { getServerBaseUrl } from "@/lib/transport"
import { OfficePreview } from "./office-preview"

const mockStart = vi.mocked(startOfficeWatch)
const mockStop = vi.mocked(stopOfficeWatch)
const mockBaseUrl = vi.mocked(getServerBaseUrl)

beforeEach(() => {
  vi.clearAllMocks()
  mockStop.mockResolvedValue(undefined)
  mockBaseUrl.mockReturnValue("https://srv.example")
})
afterEach(() => cleanup())

describe("OfficePreview", () => {
  it("web mode: proxies through the server with the cap, opaque-origin sandbox", async () => {
    mockStart.mockResolvedValue({ port: 26315, cap: "capval" })

    render(<OfficePreview rootPath="/root/reports" relPath="a.docx" />)

    await waitFor(() =>
      expect(mockStart).toHaveBeenCalledWith("/root/reports", "a.docx")
    )
    const iframe = await screen.findByTitle("officePreviewTitle")
    expect(iframe.getAttribute("src")).toBe(
      "https://srv.example/api/office-watch-proxy/26315/?cap=capval"
    )
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer")
    expect(iframe).toHaveClass(
      "absolute",
      "inset-0",
      "h-full",
      "w-full",
      "border-0",
      "bg-white"
    )
    // No allow-same-origin in web mode → the page can't read app storage.
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-scripts allow-popups allow-forms"
    )
  })

  it("stops the watch on unmount", async () => {
    mockStart.mockResolvedValue({ port: 1, cap: "c" })

    const { unmount } = render(
      <OfficePreview rootPath="/root/reports" relPath="a.docx" />
    )
    await screen.findByTitle("officePreviewTitle")
    unmount()

    expect(mockStop).toHaveBeenCalledWith("/root/reports", "a.docx")
  })

  it("web NOT_INSTALLED: shows the server-side install hint instead", async () => {
    mockStart.mockRejectedValue({
      code: "dependency_missing",
      message: "officecli is not installed",
      i18n_params: { watchCode: "NOT_INSTALLED" },
    })

    render(<OfficePreview rootPath="/root/reports" relPath="a.docx" />)

    expect(await screen.findByText("officeServerInstallHint")).toBeTruthy()
    expect(screen.queryByText("officeOpenSettings")).toBeNull()
  })

  it("offers retry for a START_FAILED error and re-starts the watch", async () => {
    mockStart.mockRejectedValueOnce({
      code: "task_execution_failed",
      message: "boom",
      i18n_params: { watchCode: "START_FAILED" },
    })
    mockStart.mockResolvedValueOnce({ port: 5, cap: "c" })

    render(<OfficePreview rootPath="/root/reports" relPath="a.docx" />)

    const retry = await screen.findByText("officeWatchRetry")
    expect(mockStart).toHaveBeenCalledTimes(1)
    fireEvent.click(retry)
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(2))
  })
})
