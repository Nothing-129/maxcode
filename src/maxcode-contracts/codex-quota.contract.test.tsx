import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidebarCodexQuota } from "@/components/layout/sidebar-codex-quota"
import { SidebarFooter } from "@/components/layout/sidebar-footer"
import enMessages from "@/i18n/messages/en.json"
import type { CodexQuota } from "@/lib/codex-quota"
import { source } from "./contract-source"

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  changed: null as (() => void) | null,
  reconnect: null as (() => void) | null,
  unsubscribe: vi.fn(),
}))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: mocks.call }),
}))
vi.mock("@/lib/platform", () => ({
  onTransportReconnect: (callback: () => void) => {
    mocks.reconnect = callback
    return vi.fn()
  },
  subscribe: (_: string, callback: () => void) => {
    mocks.changed = callback
    return Promise.resolve(mocks.unsubscribe)
  },
}))
vi.mock("@/components/layout/status-bar-stats", () => ({
  StatusBarStats: () => <button>128 conversations</button>,
}))
vi.mock("@/components/layout/status-bar-update", () => ({
  StatusBarUpdate: () => <button>v0.30.47</button>,
}))
vi.mock("@/components/layout/status-bar-alerts", () => ({
  StatusBarAlerts: () => null,
}))
const official: CodexQuota = {
  official: true,
  plan_type: "plus",
  windows: [
    { window_minutes: 300, used_percent: 25, resets_at: 1800000000 },
    { window_minutes: 10080, used_percent: 100, resets_at: 1800100000 },
  ],
  updated_at: 1790000000,
  error: null,
}
async function mount(footer = false) {
  const result = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {footer ? <SidebarFooter /> : <SidebarCodexQuota />}
    </NextIntlClientProvider>
  )
  await act(async () => {})
  return result
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.call.mockReset().mockResolvedValue(official)
  mocks.unsubscribe.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

const quotaButton = () => screen.getByRole("button", { name: /^Codex quota/ })
async function openDetails() {
  await act(async () => {
    fireEvent.click(quotaButton())
  })
}
async function refreshQuota() {
  await openDetails()
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Refresh quota" }))
  })
}

describe("inline sidebar official Codex quota", () => {
  it("hides without official login, including API key and third-party responses", async () => {
    mocks.call.mockResolvedValue({ ...official, official: false, windows: [] })
    const { container } = await mount()
    expect(container).toBeEmptyDOMElement()
  })

  it("keeps Plus percentages inline and preserves exhausted zero without progress bars", async () => {
    await mount()
    expect(quotaButton()).toHaveAccessibleName(
      "Codex quota · Remaining · 5h 75% · week 0%"
    )
    expect(quotaButton()).toHaveAttribute(
      "title",
      expect.stringContaining("Plus")
    )
    expect(quotaButton()).toHaveAttribute(
      "title",
      expect.stringContaining("Resets")
    )
    expect(quotaButton()).toHaveTextContent("5h 75% · week 0%")
    expect(quotaButton()).toHaveClass(
      "font-mono",
      "text-xs",
      "font-normal",
      "text-muted-foreground"
    )
    expect(quotaButton().querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true"
    )
    expect(quotaButton().querySelector("svg")).toHaveClass("size-3", "shrink-0")
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(screen.queryByText("Plus")).not.toBeInTheDocument()
  })

  it("shows only weekly for Pro even when the API supplies a short window", async () => {
    mocks.call.mockResolvedValue({ ...official, plan_type: "pro" })
    await mount()
    expect(quotaButton()).toHaveAccessibleName(
      "Codex quota · Remaining · week 0%"
    )
    expect(quotaButton()).not.toHaveTextContent("5h")
    expect(quotaButton()).toHaveAttribute(
      "title",
      expect.stringContaining("Pro")
    )
    await openDetails()
    expect(screen.getAllByRole("progressbar")).toHaveLength(1)
    expect(
      screen.getByRole("progressbar", { name: "Weekly · Remaining" })
    ).toHaveAttribute("aria-valuenow", "0")
  })

  it("never substitutes Pro's short window for missing weekly data", async () => {
    mocks.call.mockResolvedValue({
      ...official,
      plan_type: "pro",
      windows: [official.windows[0]],
    })
    await mount()
    expect(quotaButton()).toHaveTextContent("—")
    expect(quotaButton()).toHaveAttribute(
      "title",
      expect.stringContaining("Quota temporarily unavailable")
    )
  })

  it("does not invent a missing Plus 5-hour window", async () => {
    mocks.call.mockResolvedValue({
      ...official,
      windows: [official.windows[1]],
    })
    await mount()
    expect(quotaButton()).toHaveAccessibleName(
      "Codex quota · Remaining · week 0%"
    )
    expect(quotaButton()).not.toHaveTextContent("5h")
  })

  it("opens full reset details and refresh on click instead of consuming footer space", async () => {
    await mount()
    expect(
      screen.queryByRole("button", { name: "Refresh quota" })
    ).not.toBeInTheDocument()
    await openDetails()
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(mocks.call).toHaveBeenLastCalledWith("codex_subscription_quota", {
      force: true,
    })
    expect(screen.getByRole("dialog")).toHaveTextContent("Codex quota · Plus")
    expect(screen.getByRole("dialog")).toHaveTextContent("5 hours")
    expect(screen.getByRole("dialog")).toHaveTextContent("Weekly")
    const short = screen.getByRole("progressbar", {
      name: "5 hours · Remaining",
    })
    const weekly = screen.getByRole("progressbar", {
      name: "Weekly · Remaining",
    })
    expect(short).toHaveAttribute("aria-valuenow", "75")
    expect(short.firstElementChild).toHaveStyle({ width: "75%" })
    expect(weekly).toHaveAttribute("aria-valuenow", "0")
    expect(weekly.firstElementChild).toHaveStyle({ width: "0%" })
    expect(quotaButton().querySelector("[role='progressbar']")).toBeNull()
    expect(screen.getByRole("button", { name: "Refresh quota" })).toBeVisible()
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(mocks.call).toHaveBeenCalledTimes(2)
    await openDetails()
    expect(mocks.call).toHaveBeenCalledTimes(3)
  })

  it("keeps details open while refreshing and coalesces repeated opens during the request", async () => {
    await mount()
    let finish!: (value: CodexQuota) => void
    mocks.call.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    await openDetails()
    expect(screen.getByRole("button", { name: "Refresh quota" })).toBeDisabled()
    expect(mocks.call).toHaveBeenCalledTimes(2)
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    })
    await openDetails()
    expect(mocks.call).toHaveBeenCalledTimes(2)
    await act(async () => {
      finish({
        ...official,
        windows: [{ ...official.windows[0], used_percent: 40 }],
      })
    })
    expect(quotaButton()).toHaveTextContent("5h 60%")
    expect(screen.getByRole("dialog")).toHaveTextContent("Remaining 60%")
    expect(screen.getByRole("button", { name: "Refresh quota" })).toBeEnabled()
  })

  it("refreshes every five minutes and cleans up subscriptions", async () => {
    const { unmount } = await mount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299999)
    })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.call).toHaveBeenCalledTimes(2)
    await refreshQuota()
    expect(mocks.call).toHaveBeenLastCalledWith("codex_subscription_quota", {
      force: true,
    })
    unmount()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300000)
    })
    expect(mocks.call).toHaveBeenCalledTimes(4)
  })

  it("marks previous numbers stale after failure", async () => {
    await mount()
    mocks.call.mockRejectedValueOnce(new Error("offline"))
    await openDetails()
    expect(quotaButton()).toHaveAccessibleName(
      "Codex quota · Remaining · 5h 75% · week 0% · Last known"
    )
    expect(quotaButton()).toHaveAttribute(
      "title",
      expect.stringContaining("Refresh failed")
    )
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "last successful reading"
    )
  })

  it("clears previous login and ignores late responses", async () => {
    let resolveOld!: (value: CodexQuota) => void
    mocks.call.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      })
    )
    await mount()
    mocks.call.mockResolvedValueOnce({
      ...official,
      official: false,
      windows: [],
    })
    await act(async () => {
      mocks.changed?.()
    })
    await act(async () => {
      resolveOld(official)
    })
    expect(
      screen.queryByRole("button", { name: /^Codex quota/ })
    ).not.toBeInTheDocument()
  })

  it("sits in the existing footer row between conversation count and version", async () => {
    const { container } = await mount(true)
    expect(
      screen.getAllByRole("button").map((button) => button.textContent)
    ).toEqual(["128 conversations", "5h 75% · week 0%", "v0.30.47"])
    const footer = container.querySelector("[data-sidebar-footer]")
    expect(footer).not.toHaveClass("flex-wrap")
    expect(quotaButton().closest("[data-sidebar-footer]")).toBe(footer)
    const separators = footer?.querySelectorAll(
      "[data-sidebar-quota-separator]"
    )
    expect(separators).toHaveLength(2)
    expect(quotaButton().parentElement).not.toHaveClass("gap-2")
    for (const separator of separators ?? []) {
      expect(separator).toHaveClass("flex-1", "justify-center")
      expect(separator).toHaveTextContent("｜")
      expect(separator).toHaveAttribute("aria-hidden", "true")
    }
    expect(source("src/components/layout/sidebar.tsx")).not.toContain(
      "<SidebarCodexQuota />"
    )
    expect(source("src-tauri/src/commands/codex_quota.rs")).toContain(
      "codex-quota.contract.rs"
    )
  })
})
