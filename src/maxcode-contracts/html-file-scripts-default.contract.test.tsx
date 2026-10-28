import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { HtmlPreview } from "@/components/files/html-preview"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"
import en from "@/i18n/messages/en.json"

vi.mock("@/lib/api", () => ({
  readWorkspaceFileBase64: vi.fn(),
}))

const tab: FileWorkspaceTab = {
  id: "report",
  kind: "file",
  folderId: null,
  title: "report.html",
  description: null,
  path: "/workspace/report.html",
  language: "html",
  content:
    '<html><head><title>Report</title></head><body><script>document.body.textContent = "Rendered report"</script></body></html>',
  loading: false,
}

async function preview() {
  return waitFor(() => {
    const frame = document.querySelector("iframe")
    expect(frame).not.toBeNull()
    return frame!
  })
}

describe("MaxCode: opened HTML files run scripts by default", () => {
  it("starts with scripts and resource access enabled inside an opaque sandbox", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <HtmlPreview tab={tab} rootPath="/workspace" />
      </NextIntlClientProvider>
    )

    const frame = await preview()
    expect(frame.getAttribute("sandbox")?.split(" ")).toContain("allow-scripts")
    expect(frame.getAttribute("sandbox")?.split(" ")).not.toContain(
      "allow-same-origin"
    )
    const html = frame.getAttribute("srcdoc") ?? ""
    expect(html).toContain('document.body.textContent = "Rendered report"')
    expect(html).toContain("script-src 'unsafe-inline' 'unsafe-eval'")
    expect(html).toContain("connect-src https: http:")
    expect(html).toContain("frame-src 'none'")
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true")
  })

  it("lets the user turn scripts off and back on", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <HtmlPreview tab={tab} rootPath="/workspace" />
      </NextIntlClientProvider>
    )
    await preview()

    fireEvent.click(screen.getByRole("button"))
    const strictFrame = await preview()
    expect(strictFrame).toHaveAttribute("sandbox", "")
    expect(strictFrame.getAttribute("srcdoc")).toContain("script-src 'none'")
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(screen.getByRole("button"))
    const enabledFrame = await preview()
    expect(enabledFrame.getAttribute("sandbox")).toContain("allow-scripts")
    expect(enabledFrame.getAttribute("srcdoc")).not.toContain(
      "script-src 'none'"
    )
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true")
  })
})
