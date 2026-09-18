import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateContextValue } from "@/components/providers/update-provider"
import type { AppUpdateState } from "@/lib/updater"

// Drive the component straight off the context value: the provider's own
// behaviour (checking, scheduling, seq guards) is covered in its test.
let ctx: UpdateContextValue | null = null
vi.mock("@/components/providers/update-provider", () => ({
  useAppUpdate: () => ctx,
}))

const openUrl = vi.fn()
vi.mock("@/lib/platform", () => ({ openUrl: (u: string) => openUrl(u) }))

const { toastInfo, toastDismiss } = vi.hoisted(() => ({
  toastInfo: vi.fn(),
  toastDismiss: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: { info: toastInfo, dismiss: toastDismiss },
}))

import { StatusBarUpdate } from "./status-bar-update"
import enMessages from "@/i18n/messages/en.json"

const startUpdate = vi.fn(async () => {})
const restart = vi.fn(async () => {})
const dismissAvailable = vi.fn()
const checkNow = vi.fn(async () => {})

function makeCtx(overrides: Partial<UpdateContextValue>): UpdateContextValue {
  const state: AppUpdateState = overrides.state ?? { seq: 1, status: "idle" }
  return {
    state,
    isUpdating: state.status === "downloading" || state.status === "installing",
    restartCountdown: null,
    isRollingBack: false,
    isRestarting: false,
    hydrated: true,
    isBusy: false,
    available: null,
    currentVersion: "0.21.7",
    checking: false,
    checkError: null,
    lastCheckedAt: new Date("2026-07-24T10:00:00Z"),
    selfUpdateSupported: false,
    liveProgress: false,
    runtime: undefined,
    rollbackAvailable: false,
    canInstallInPlace: true,
    dismissedVersion: null,
    checkNow,
    dismissAvailable,
    refreshLocalStatus: vi.fn(async () => {}),
    startUpdate,
    restart,
    rollback: vi.fn(async () => {}),
    ...overrides,
  }
}

function renderWith(overrides: Partial<UpdateContextValue>) {
  ctx = makeCtx(overrides)
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StatusBarUpdate />
    </NextIntlClientProvider>
  )
}

const RELEASE = { version: "0.21.9", body: "## Fixes", date: "2026-07-24" }

beforeEach(() => {
  startUpdate.mockClear()
  restart.mockClear()
  dismissAvailable.mockClear()
  checkNow.mockClear()
  toastInfo.mockClear()
  toastDismiss.mockClear()
  openUrl.mockClear()
  localStorage.clear()
})

describe("StatusBarUpdate — direct update action", () => {
  it("checks for updates directly when the version is clicked", () => {
    renderWith({})
    const version = screen.getByRole("button", { name: "v0.21.7" })
    expect(version).toHaveAttribute("title", "Check for updates")
    fireEvent.click(version)
    expect(checkNow).toHaveBeenCalledWith({ silent: false })
    expect(startUpdate).not.toHaveBeenCalled()
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("renders nothing outside a provider", () => {
    ctx = null
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StatusBarUpdate />
      </NextIntlClientProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("puts a filled circular icon after the version and downloads on the first click without notifications or details", async () => {
    renderWith({ available: RELEASE })
    const button = screen.getByRole("button", {
      name: "Download update and restart",
    })
    expect(button.previousElementSibling).toHaveTextContent("v0.21.7")
    // The pill collapses to just the icon; the label only shows on hover.
    expect(button.textContent).toBe("Update")
    expect(button.querySelector("svg")).toHaveClass("group-hover:hidden")
    expect(button.querySelector("span")).toHaveClass(
      "hidden",
      "group-hover:inline"
    )
    expect(button).toHaveClass("rounded-full", "bg-[#3ca1ef]", "text-white")
    expect(startUpdate).not.toHaveBeenCalled()
    expect(toastInfo).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(startUpdate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Update available")).toBeNull()
    expect(screen.queryByText("## Fixes")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it("keeps the action reachable for previously dismissed releases", () => {
    renderWith({ available: RELEASE, dismissedVersion: RELEASE.version })
    expect(
      screen.getByRole("button", { name: "Download update and restart" })
    ).toBeVisible()
    expect(toastInfo).not.toHaveBeenCalled()
  })

  it("disables the action and exposes progress while downloading", () => {
    renderWith({
      state: { seq: 2, status: "downloading", downloaded: 50, total: 200 },
    })
    const button = screen.getByRole("button", { name: /Downloading.*25%/ })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(startUpdate).not.toHaveBeenCalled()
  })

  it("keeps the restart action as a fallback for a staged update", async () => {
    renderWith({ state: { seq: 4, status: "ready_to_restart" } })
    const button = screen.getByRole("button", { name: "Restart to update" })
    fireEvent.click(button)
    expect(restart).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it("disables the icon during restart", () => {
    renderWith({ state: { seq: 6, status: "restarting" }, isRestarting: true })
    expect(screen.getByRole("button", { name: /Restarting/ })).toBeDisabled()
  })

  it("retries failed downloads directly", async () => {
    renderWith({
      state: { seq: 7, status: "error", error: "network error" },
      available: RELEASE,
    })
    const button = screen.getByRole("button", { name: /Update failed.*Retry/ })
    fireEvent.click(button)
    expect(startUpdate).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it("retains manual installation for unsupported clients", async () => {
    renderWith({ available: RELEASE, canInstallInPlace: false })
    const button = screen.getByRole("button", {
      name: /View v0\.21\.9 release/,
    })
    fireEvent.click(button)
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/Nothing-129/maxcode/releases/latest"
    )
    expect(startUpdate).not.toHaveBeenCalled()
    await waitFor(() => expect(button).not.toBeDisabled())
  })
})
