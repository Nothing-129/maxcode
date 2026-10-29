import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, expect, it, vi } from "vitest"
import messages from "@/i18n/messages/en.json"
import {
  UserResourceLinks,
  withoutResourceLinks,
} from "@/components/message/user-resource-links"
import { source } from "./contract-source"

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  reveal: vi.fn(async () => {}),
  systemOpen: vi.fn(async () => {}),
  local: vi.fn(() => true),
  error: vi.fn(),
}))
vi.mock("@/components/ai-elements/link-safety", async (original) => ({
  ...(await original<typeof import("@/components/ai-elements/link-safety")>()),
  useOpenLinkOrFile: () => mocks.open,
}))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({ activeFolder: { path: "/repo" } }),
}))
vi.mock("@/lib/platform", () => ({
  isLocalDesktop: mocks.local,
  revealItemInDir: mocks.reveal,
  openPath: mocks.systemOpen,
}))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))
const uri = "file:///repo/%E6%97%A5%E5%BF%97%20(1).log"
const resources = [{ name: "日志 (1).log", uri }]
function show() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <UserResourceLinks resources={resources} />
    </NextIntlClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.local.mockReturnValue(true)
})
it("removes only card references from display while retaining sent text for edit and copy", () => {
  const text = `查看日志[日志 (1).log](<${uri}>) [助手](codeg://agent/codex)`
  const parts = [{ type: "text" as const, text }]
  expect(withoutResourceLinks(parts, resources)).toEqual([
    { type: "text", text: "查看日志 [助手](codeg://agent/codex)" },
  ])
  expect(parts[0].text).toBe(text)
  const plain = [{ type: "text" as const, text: "  keep whitespace\n" }]
  expect(withoutResourceLinks(plain, [])).toBe(plain)
  expect(withoutResourceLinks(plain, resources)[0]).toBe(plain[0])
  expect(
    withoutResourceLinks(
      [{ type: "text", text: `[日志](<${uri}>)` }],
      resources
    )[0]
  ).toEqual({ type: "text", text: "" })
  const view = source("src/components/message/message-list-view.tsx")
  expect(view).toMatch(
    /<MessageContent>[\s\S]*?<UserResourceLinks resources=\{group.resources\}[\s\S]*?<\/MessageContent>/
  )
  expect(view.match(/<UserResourceLinks /g)).toHaveLength(1)
})
it("opens the attachment and reveals the decoded local path", async () => {
  show()
  fireEvent.click(screen.getByRole("button", { name: /日志/ }))
  expect(mocks.open).toHaveBeenCalledWith(uri)
  fireEvent.click(screen.getByRole("button", { name: /Open in/ }))
  await waitFor(() =>
    expect(mocks.reveal).toHaveBeenCalledWith("/repo/日志 (1).log")
  )
})
it("offers a system application action in the attachment context menu", async () => {
  show()
  fireEvent.contextMenu(screen.getByRole("button", { name: /日志/ }))
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: messages.Folder.chat.fileActions.openWithDefaultApp,
    })
  )
  await waitFor(() =>
    expect(mocks.systemOpen).toHaveBeenCalledWith("/repo/日志 (1).log")
  )
})
it("hides local reveal on remote or browser workspaces", () => {
  mocks.local.mockReturnValue(false)
  show()
  expect(screen.queryByRole("button", { name: /Open in/ })).toBeNull()
})
it("reports a missing file instead of silently ignoring a failed reveal", async () => {
  mocks.reveal.mockRejectedValueOnce(new Error("File missing"))
  show()
  fireEvent.click(screen.getByRole("button", { name: /Open in/ }))
  await waitFor(() => expect(mocks.error).toHaveBeenCalled())
})
