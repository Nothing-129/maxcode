import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const notify = vi.fn(async () => true)
const openSettings = vi.fn(async () => {})
const desktop = vi.fn(() => true)

vi.mock("./electron", () => ({
  isElectron: () => desktop(),
  getElectronBridge: () =>
    desktop() ? { notify, openNotificationSettings: openSettings } : null,
}))

import {
  deliverSystemNotification,
  getNotificationPermission,
  openSystemNotificationSettings,
  requestNotificationPermission,
} from "./notification"

interface FakeNotificationCtor {
  (title: string, options?: { body?: string }): void
  permission: string
  requestPermission: () => Promise<string>
}

/** Install a browser `Notification` with the given permission state. */
function installNotification(
  permission: string,
  requestResult = permission
): { constructed: Array<[string, { body?: string } | undefined]> } {
  const constructed: Array<[string, { body?: string } | undefined]> = []
  const ctor = function (title: string, options?: { body?: string }) {
    constructed.push([title, options])
  } as unknown as FakeNotificationCtor
  ctor.permission = permission
  ctor.requestPermission = vi.fn(async () => {
    ctor.permission = requestResult
    return requestResult
  })
  Object.defineProperty(window, "Notification", {
    value: ctor,
    configurable: true,
    writable: true,
  })
  return { constructed }
}

function removeNotification() {
  Object.defineProperty(window, "Notification", {
    value: undefined,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  notify.mockReset().mockResolvedValue(true)
  openSettings.mockClear()
  desktop.mockReturnValue(true)
  removeNotification()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getNotificationPermission", () => {
  it("reports the desktop as OS-managed rather than inventing a state", () => {
    expect(getNotificationPermission()).toBe("managed_by_os")
  })

  it("reports `unsupported` when the browser has no Notification API", () => {
    // The shape of a `codeg-server` reached over plain http:// on a LAN
    // address: not a secure context, so the constructor is simply absent.
    desktop.mockReturnValue(false)
    expect(getNotificationPermission()).toBe("unsupported")
  })

  it.each([
    ["granted", "granted"],
    ["denied", "denied"],
    ["default", "default"],
    ["something-else", "default"],
  ])("maps browser permission %s to %s", (browser, expected) => {
    desktop.mockReturnValue(false)
    installNotification(browser)
    expect(getNotificationPermission()).toBe(expected)
  })
})

describe("requestNotificationPermission", () => {
  it("asks the browser and reports the answer", async () => {
    desktop.mockReturnValue(false)
    installNotification("default", "granted")

    await expect(requestNotificationPermission()).resolves.toBe("granted")
  })

  it("is a no-op on desktop", async () => {
    await expect(requestNotificationPermission()).resolves.toBe("managed_by_os")
  })

  it("treats a rejected request as still undecided", async () => {
    desktop.mockReturnValue(false)
    installNotification("default")
    const ctor = window.Notification as unknown as FakeNotificationCtor
    ctor.requestPermission = vi.fn(async () => {
      throw new Error("legacy callback API")
    })

    await expect(requestNotificationPermission()).resolves.toBe("default")
  })
})

describe("deliverSystemNotification", () => {
  it("posts through the Electron preload bridge", async () => {
    await deliverSystemNotification("t", "b")
    expect(notify).toHaveBeenCalledWith("t", "b")
  })

  it("propagates a failed native delivery", async () => {
    notify.mockResolvedValueOnce(false)
    await expect(deliverSystemNotification("t", "b")).rejects.toThrow(
      "unavailable"
    )
  })

  it("constructs a browser notification once permission is granted", async () => {
    desktop.mockReturnValue(false)
    const { constructed } = installNotification("granted")

    await deliverSystemNotification("t", "b")

    expect(constructed).toEqual([["t", { body: "b" }]])
  })

  it("refuses, rather than prompting, when the browser has not granted", async () => {
    // A prompt raised from the event path cannot succeed — the page is
    // backgrounded and carries no user activation. Requesting belongs to the
    // Settings button and nowhere else.
    desktop.mockReturnValue(false)
    const { constructed } = installNotification("default")
    const ctor = window.Notification as unknown as FakeNotificationCtor

    await expect(deliverSystemNotification("t", "b")).rejects.toThrow(
      /permission/i
    )
    expect(ctor.requestPermission).not.toHaveBeenCalled()
    expect(constructed).toEqual([])
  })

  it("fails loudly with no Notification API at all", async () => {
    desktop.mockReturnValue(false)
    await expect(deliverSystemNotification("t", "b")).rejects.toThrow(
      /not available/i
    )
  })
})

describe("openSystemNotificationSettings", () => {
  it("calls the local command on desktop", async () => {
    await openSystemNotificationSettings()
    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  it("refuses in a browser, where no page may open the permission UI", async () => {
    desktop.mockReturnValue(false)
    await expect(openSystemNotificationSettings()).rejects.toThrow(/desktop/i)
    expect(openSettings).not.toHaveBeenCalled()
  })
})
