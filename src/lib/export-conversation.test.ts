import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ desktop: false, saveFile: vi.fn() }))
vi.mock("./electron", () => ({
  getElectronBridge: () =>
    mocks.desktop ? { saveFile: mocks.saveFile } : null,
}))

import {
  exportAsHtml,
  exportAsMarkdown,
  type ExportConversationData,
  type ExportLabels,
} from "./export-conversation"
// jsdom doesn't ship `URL.createObjectURL` / `revokeObjectURL`. Both are
// only reachable from the web-mode Blob path; stubbing them lets that
// branch execute end-to-end so the test can assert it ran without
// hitting the desktop native bridge.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:mock",
  })
}
if (typeof URL.revokeObjectURL !== "function") {
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => {},
  })
}

// jsdom logs an unimplemented-navigation warning when `<a>.click()` fires
// on a real URL. The web Blob path triggers exactly that — neutralize the
// click so it doesn't pollute CI logs while still letting the rest of the
// flow run.
Object.defineProperty(HTMLAnchorElement.prototype, "click", {
  configurable: true,
  value: () => {},
})

function makeLabels(): ExportLabels {
  return {
    untitledConversation: "Untitled",
    agent: "Agent",
    model: "Model",
    status: "Status",
    started: "Started",
    updated: "Updated",
    tokens: "Tokens",
    duration: "Duration",
    inputTokens: "Input",
    outputTokens: "Output",
    cacheRead: "Cache read",
    cacheWrite: "Cache write",
    user: "User",
    assistant: "Assistant",
    system: "System",
    toolResult: "Tool result",
    toolError: "Tool error",
    statusLabels: {},
  }
}

function makeData(): ExportConversationData {
  return {
    summary: {
      id: 1,
      folder_id: 1,
      title: "Test Conversation",
      title_locked: false,
      agent_type: "claude_code",
      status: "completed",
      kind: "regular",
      model: null,
      git_branch: null,
      external_id: null,
      message_count: 1,
      child_count: 0,
      created_at: "2026-05-27T00:00:00Z",
      updated_at: "2026-05-27T00:00:00Z",
      pinned_at: null,
    },
    turns: [
      {
        id: "t1",
        role: "user",
        blocks: [{ type: "text", text: "hello" }],
        timestamp: "2026-05-27T00:00:00Z",
      },
    ],
    sessionStats: null,
    labels: makeLabels(),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.desktop = false
})

// ---------------------------------------------------------------------------
// exportAsMarkdown — the function that triggered issue #202.
//
// The bug was: macOS WKWebView denied the legacy `<a download>` write at the
// TCC layer, but the front-end couldn't observe the failure and reported
// success. These tests lock the new contract:
//
//   - desktop happy path     → opens save dialog, invokes the native bridge,
//                              returns "saved"
//   - desktop cancellation   → returns "cancelled", does NOT invoke
//   - desktop write failure  → propagates as an exception (caller renders
//                              an error toast instead of a false success)
//   - web fallback           → uses the legacy Blob path, returns "saved",
//                              never imports the native bridge
//
// If a future edit reverts to the bug pattern (synchronous Blob link from
// a desktop code path), one of these expectations will fail loudly.
// ---------------------------------------------------------------------------

describe("exportAsMarkdown", () => {
  describe("desktop mode", () => {
    beforeEach(() => {
      mocks.desktop = true
    })

    it("opens a save dialog with the Markdown filter and writes via the native bridge", async () => {
      mocks.saveFile.mockResolvedValue("/Users/me/out.md")

      const result = await exportAsMarkdown(makeData())

      expect(result).toBe("saved")
      expect(mocks.saveFile).toHaveBeenCalledTimes(1)
      const saveArgs = mocks.saveFile.mock.calls[0][0]!
      expect(saveArgs.filters).toEqual([
        { name: "Markdown", extensions: ["md"] },
      ])
      expect(saveArgs.defaultPath).toMatch(/\.md$/)

      const bytes = mocks.saveFile.mock.calls[0][1] as Uint8Array
      expect(new TextDecoder().decode(bytes)).toContain("hello")
    })

    it("returns 'cancelled' and writes no file when the user dismisses the dialog", async () => {
      mocks.saveFile.mockResolvedValue(null)

      const result = await exportAsMarkdown(makeData())

      expect(result).toBe("cancelled")
    })

    it("propagates the error when the underlying write fails (no false success)", async () => {
      mocks.saveFile.mockResolvedValue("/Users/me/out.md")
      mocks.saveFile.mockRejectedValue(new Error("PermissionDenied"))

      await expect(exportAsMarkdown(makeData())).rejects.toThrow(
        "PermissionDenied"
      )
    })
  })

  describe("web mode", () => {
    beforeEach(() => {
      mocks.desktop = false
    })

    it("uses the Blob download path and never touches native bridge", async () => {
      const result = await exportAsMarkdown(makeData())

      expect(result).toBe("saved")
      expect(mocks.saveFile).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// exportAsHtml — same dispatch contract as markdown; lock the HTML-specific
// filter so editors can't accidentally swap the suggested extension.
// ---------------------------------------------------------------------------

describe("exportAsHtml", () => {
  it("uses the HTML filter and routes through the native bridge on desktop", async () => {
    mocks.desktop = true
    mocks.saveFile.mockResolvedValue("/Users/me/out.html")

    const result = await exportAsHtml(makeData())

    expect(result).toBe("saved")
    expect(mocks.saveFile.mock.calls[0][0]!.filters).toEqual([
      { name: "HTML", extensions: ["html"] },
    ])
    expect(new TextDecoder().decode(mocks.saveFile.mock.calls[0][1])).toContain(
      "hello"
    )
  })
})

// Note on exportAsImage: deliberately not unit-tested here.
//
// The image flow needs an iframe-rendered DOM (`iframe.onload` via
// `srcdoc`, body `scrollHeight`, `requestAnimationFrame`) and a canvas
// for `html-to-image` to rasterize — none of which jsdom supports. After
// `toPng` returns, the function is a thin wrapper that strips the
// `data:image/png;base64,` prefix and delegates to `downloadImage`, which
// owns the same desktop/web dispatch contract locked down above and is
// already shipped in production. Re-asserting that contract here would
// require mocking the entire iframe pipeline for marginal additional
// regression coverage.
