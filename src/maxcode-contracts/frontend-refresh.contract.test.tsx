import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider } from "next-intl"
import en from "@/i18n/messages/en.json"
import {
  MobileFrontendRefresh,
  MobileFrontendRefreshItem,
} from "@/components/layout/mobile-frontend-refresh"
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu"
import { source } from "./contract-source"

const f = vi.hoisted(() => ({
  mobile: true,
  reconnect: undefined as (() => void) | undefined,
  unsubscribe: vi.fn(),
  refresh: vi.fn(),
  toast: Object.assign(
    vi.fn(() => "update-toast"),
    { dismiss: vi.fn() }
  ),
}))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => f.mobile }))
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({
    onReconnect: (cb: () => void) => {
      f.reconnect = cb
      return f.unsubscribe
    },
  }),
}))
vi.mock("@/lib/refresh-frontend", () => ({ refreshFrontend: f.refresh }))
vi.mock("sonner", () => ({ toast: f.toast }))

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MobileFrontendRefresh />
    </NextIntlClientProvider>
  )
const reply = (buildId: string) => ({
  ok: true,
  json: async () => ({ buildId }),
})

beforeEach(() => {
  vi.clearAllMocks()
  f.mobile = true
  f.reconnect = undefined
  vi.stubEnv("NEXT_PUBLIC_FRONTEND_BUILD_ID", "loaded-build")
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("mobile frontend refresh", () => {
  it("compares frontend builds on reconnect and foreground, prompts once and only reloads on click", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply("loaded-build"))
    vi.stubGlobal("fetch", fetcher)
    const view = mount()
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledWith("/frontend-version.json", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    })
    expect(f.toast).not.toHaveBeenCalled()
    fetcher.mockResolvedValue(reply("new-build"))
    await act(async () => f.reconnect?.())
    expect(f.toast).toHaveBeenCalledOnce()
    expect(f.refresh).not.toHaveBeenCalled()
    await act(async () => fireEvent(window, new Event("focus")))
    await act(async () => fireEvent(document, new Event("visibilitychange")))
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(f.toast).toHaveBeenCalledOnce()
    const options = (
      f.toast.mock.calls[0] as unknown as [
        string,
        {
          action: { onClick: () => void }
        },
      ]
    )[1]
    options.action.onClick()
    expect(f.refresh).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", { name: "Refresh interface" })
    ).toBeNull()
    view.unmount()
    expect(f.unsubscribe).toHaveBeenCalledOnce()
    expect(f.toast.dismiss).toHaveBeenCalledWith("update-toast")
  })

  it("deduplicates in-flight checks and ignores a response after unmount", async () => {
    let resolve!: (value: ReturnType<typeof reply>) => void
    const fetcher = vi.fn(
      () =>
        new Promise<ReturnType<typeof reply>>((done) => {
          resolve = done
        })
    )
    vi.stubGlobal("fetch", fetcher)
    const view = mount()
    fireEvent.focus(window)
    f.reconnect?.()
    expect(fetcher).toHaveBeenCalledOnce()
    view.unmount()
    await act(async () => resolve(reply("new-build")))
    expect(f.toast).not.toHaveBeenCalled()
  })

  it("recovers from offline and invalid responses without prompting or clearing storage", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "0.30.9" }),
      })
      .mockResolvedValueOnce(reply("new-build"))
    vi.stubGlobal("fetch", fetcher)
    mount()
    await act(async () => {})
    await act(async () => f.reconnect?.())
    expect(f.toast).not.toHaveBeenCalled()
    await act(async () => f.reconnect?.())
    expect(f.toast).toHaveBeenCalledOnce()
  })

  it("does not check or render on desktop", () => {
    f.mobile = false
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    mount()
    expect(screen.queryByRole("button")).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("waits until visible before checking again", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get")
    visibility.mockReturnValue("hidden")
    const fetcher = vi.fn().mockResolvedValue(reply("new-build"))
    vi.stubGlobal("fetch", fetcher)
    try {
      mount()
      f.reconnect?.()
      expect(fetcher).not.toHaveBeenCalled()
      visibility.mockReturnValue("visible")
      await act(async () => fireEvent(document, new Event("visibilitychange")))
      expect(fetcher).toHaveBeenCalledOnce()
      expect(f.toast).toHaveBeenCalledOnce()
    } finally {
      visibility.mockRestore()
    }
  })

  it("reloads the current route and query without modifying credentials", async () => {
    const { refreshFrontend } = await vi.importActual<
      typeof import("@/lib/refresh-frontend")
    >("@/lib/refresh-frontend")
    const replace = vi.fn()
    const href = "https://example.com/workspace/?conversation=42#message"
    vi.stubGlobal("window", { location: { href, replace } })
    refreshFrontend()
    const target = new URL(replace.mock.calls[0][0])
    expect(target.origin).toBe("https://example.com")
    expect(target.pathname).toBe("/workspace/")
    expect(target.searchParams.get("conversation")).toBe("42")
    expect(target.searchParams.has("_frontend_reload")).toBe(true)
    expect(target.hash).toBe("#message")
  })

  it("refreshes from the tools menu without a title-row button", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <DropdownMenu open>
          <DropdownMenuContent>
            <MobileFrontendRefreshItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </NextIntlClientProvider>
    )
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh interface" }))
    expect(f.refresh).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", { name: "Refresh interface" })
    ).toBeNull()
  })

  it("keeps the detector mounted outside the menu and refresh inside it", () => {
    expect(source("src/components/layout/folder-title-bar.tsx")).toContain(
      "<MobileFrontendRefresh />\n      <DropdownMenu>"
    )
    const header = source("src/components/layout/folder-title-bar.tsx")
    expect(header).toMatch(
      /tTitleBar\("openSettings"\)[\s\S]*?<MobileFrontendRefreshItem \/>[\s\S]*?<\/DropdownMenuContent>/
    )
    const refresh = source("src/lib/refresh-frontend.ts")
    expect(refresh).toContain("new URL(window.location.href)")
    expect(refresh).toContain("window.location.replace(url.href)")
    expect(refresh).not.toMatch(/localStorage|sessionStorage|clear|draft/i)
    expect(source("src-tauri/src/web/router.rs")).toContain(
      "middleware::from_fn(super::frontend_cache::frontend_cache)"
    )
  })
})
