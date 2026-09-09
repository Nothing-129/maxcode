import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, expect, it, vi } from "vitest"
import { UpdateProvider } from "@/components/providers/update-provider"
import { StatusBarUpdate } from "@/components/layout/status-bar-update"
import type { AppUpdateState } from "@/lib/updater"
import messages from "@/i18n/messages/en.json"

const { backendCall, notify } = vi.hoisted(() => ({
  backendCall: vi.fn(),
  notify: vi.fn(),
}))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ call: backendCall, onReconnect: () => () => {} }),
  isDesktop: () => false,
  isRemoteDesktopMode: () => false,
  getActiveRemoteConnectionId: () => null,
}))
vi.mock("sonner", () => ({
  toast: { info: notify, success: notify, error: notify },
}))

afterEach(() => {
  Reflect.deleteProperty(window, "maxcodeElectron")
  localStorage.clear()
  vi.clearAllMocks()
})

it("checks from the version button and silently offers an adjacent icon, then downloads and restarts Electron with one click even if the update control unmounts", async () => {
  localStorage.clear()
  const check = vi.fn(async () => ({
    currentVersion: "0.30.6",
    update: { version: "0.30.7", body: "Release details", date: null },
    selfUpdateSupported: true,
    liveProgress: true,
    runtime: "electron",
    rollbackAvailable: false,
  }))
  const install = vi.fn(async () => {})
  const start = vi.fn(
    async (): Promise<AppUpdateState> => ({
      seq: 1,
      status: "downloading",
      version: "0.30.7",
    })
  )
  let listener: ((state: AppUpdateState) => void) | undefined
  Object.defineProperty(window, "maxcodeElectron", {
    configurable: true,
    value: {
      version: "0.30.6",
      getUpdateState: async () => ({ seq: 0, status: "idle" }),
      onUpdateState: (handler: typeof listener) => {
        listener = handler
        return () => {
          listener = undefined
        }
      },
      getUpdateStatus: async () => ({
        currentVersion: "0.30.6",
        update: { version: "0.30.7", body: "Release details", date: null },
        selfUpdateSupported: true,
        liveProgress: true,
        runtime: "electron",
        rollbackAvailable: false,
      }),
      checkForUpdate: check,
      startUpdate: start,
      installUpdate: install,
    },
  })
  const content = (visible: boolean) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <UpdateProvider>{visible && <StatusBarUpdate />}</UpdateProvider>
    </NextIntlClientProvider>
  )
  const view = render(content(true))
  try {
    const version = await screen.findByRole("button", { name: "v0.30.6" })
    fireEvent.click(version)
    await waitFor(() => expect(check).toHaveBeenCalledOnce())
    expect(start).not.toHaveBeenCalled()
    const button = await screen.findByRole("button", {
      name: "Download update and restart",
    })
    expect(button.previousElementSibling).toHaveTextContent("v0.30.6")
    expect(notify).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    expect(screen.queryByText("Release details")).toBeNull()
    expect(install).not.toHaveBeenCalled()
    view.rerender(content(false))
    await act(async () => {
      listener?.({ seq: 2, status: "ready_to_restart", version: "0.30.7" })
    })
    await waitFor(() => expect(install).toHaveBeenCalledOnce())
    await act(async () => {
      listener?.({ seq: 2, status: "ready_to_restart", version: "0.30.7" })
    })
    expect(install).toHaveBeenCalledOnce()
    expect(backendCall).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})
