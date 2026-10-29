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
}))
vi.mock("sonner", () => ({
  toast: { info: notify, success: notify, error: notify },
}))

afterEach(() => {
  Reflect.deleteProperty(window, "maxcodeElectron")
  localStorage.clear()
  vi.clearAllMocks()
})

it("hides the desktop action until download completes and waits for an explicit restart even across navigation and renderer remounts", async () => {
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
    const version = await screen.findByRole("button", { name: "0.30.6" })
    fireEvent.click(version)
    await waitFor(() => expect(check).toHaveBeenCalledOnce())
    expect(start).not.toHaveBeenCalled()
    expect(screen.getAllByRole("button")).toHaveLength(1)
    // The main process starts the download after checking; no renderer start IPC.
    await act(async () => {
      listener?.({ seq: 1, status: "downloading", version: "0.30.7" })
    })
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(notify).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    expect(screen.queryByText("Release details")).toBeNull()
    await act(async () => {
      listener?.({ seq: 2, status: "error", error: "Network unavailable" })
    })
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(version).not.toBeDisabled()
    expect(version).not.toHaveClass("bg-[#216ae4]")
    fireEvent.click(version)
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    await act(async () => {
      listener?.({ seq: 3, status: "downloading", version: "0.30.7" })
    })
    view.rerender(content(false))
    await act(async () => {
      listener?.({ seq: 4, status: "ready_to_restart", version: "0.30.7" })
    })
    expect(install).not.toHaveBeenCalled()
    view.rerender(content(true))
    const button = await screen.findByRole("button", {
      name: messages.SystemSettings.restartToUpdate,
    })
    expect(button).toHaveTextContent("0.30.6")
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(button.querySelectorAll("svg")).toHaveLength(1)
    expect(button.querySelector("svg")).toHaveClass(
      "text-[#216ae4]",
      "size-4",
      "motion-safe:animate-[update-arrow-nudge_4s_ease-in-out_infinite]"
    )
    expect(button.querySelector("svg")).toHaveAttribute("stroke-width", "2.75")
    expect(button).not.toHaveClass("bg-[#216ae4]")
    expect(button).toHaveAttribute("title", "Restart to update · 0.30.7")
    expect(install).not.toHaveBeenCalled()
    // A fresh renderer also must not install a package staged by the main process.
    window.maxcodeElectron!.getUpdateState = async () => ({
      seq: 4,
      status: "ready_to_restart",
      version: "0.30.7",
    })
    view.rerender(<div />)
    view.rerender(content(true))
    const restored = await screen.findByRole("button", {
      name: messages.SystemSettings.restartToUpdate,
    })
    expect(install).not.toHaveBeenCalled()
    fireEvent.click(restored)
    await waitFor(() => expect(install).toHaveBeenCalledOnce())
    expect(start).not.toHaveBeenCalled()
    expect(backendCall).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})
