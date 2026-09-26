import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MarkupMark } from "@/lib/image-markup"
import enMessages from "@/i18n/messages/en.json"
type CaptureOutcome = {
  mime: string
  data: string
  width: number
  height: number
}

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: toasts }))

import { ScreenshotMarkupDialog } from "./image-markup-dialog"

/** A picture that loads on the next tick — or fails to, for a `src` that
 *  says so. jsdom decodes no images of its own. */
class LoadingImage {
  naturalWidth = 1600
  naturalHeight = 1000
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private current = ""
  get src() {
    return this.current
  }
  set src(value: string) {
    this.current = value
    setTimeout(() => {
      if (value.includes("broken")) this.onerror?.()
      else this.onload?.()
    }, 0)
  }
}

const drawn: string[] = []

// 1600×1000 pixels of a 1200×750 image px viewport, shown at 800×500 on screen:
// one screen pixel is two picture pixels, and one picture pixel is 0.75 image px.
// The picture sits away from the window's corner, as it does in a dialog;
// the tests below give pointer positions relative to the picture.
const ORIGIN = { x: 40, y: 30 }
const capture: CaptureOutcome = {
  mime: "image/png",
  data: "iVBORw0KGgo=",
  width: 1600,
  height: 1000,
}

const BLOCK =
  "Captured from a web page…\n\n- screenshot: the visible 1200×750\n"

let encode: (type: string) => Blob | null
/** While set, encodes wait here until the test lets them finish — making
 *  the picture is asynchronous, and the person can act in between. */
let heldEncodes: Array<() => void> | null = null

beforeEach(() => {
  drawn.length = 0
  encode = (type) => new Blob([new Uint8Array(64)], { type })
  heldEncodes = null
  toasts.success.mockClear()
  toasts.error.mockClear()
  vi.stubGlobal("Image", LoadingImage)
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      new Proxy(
        {},
        {
          get: (_target, prop) =>
            typeof prop === "string" &&
            ["rect", "moveTo", "fillText", "drawImage"].includes(prop)
              ? (...args: unknown[]) => drawn.push(`${prop}:${args[0]}`)
              : () => {},
          set: () => true,
        }
      ) as unknown as CanvasRenderingContext2D
  )
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    callback,
    type = "image/png"
  ) {
    const finish = () => callback(encode(type))
    if (heldEncodes) heldEncodes.push(finish)
    else finish()
  })
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect"
  ).mockReturnValue({
    left: ORIGIN.x,
    top: ORIGIN.y,
    right: ORIGIN.x + 800,
    bottom: ORIGIN.y + 500,
    width: 800,
    height: 500,
    x: ORIGIN.x,
    y: ORIGIN.y,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(
  over: Partial<CaptureOutcome> = {},
  initialMarks: MarkupMark[] = []
) {
  const onCancel = vi.fn()
  const onSend = vi.fn()
  const onFailed = vi.fn()
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ScreenshotMarkupDialog
        capture={{ ...capture, ...over }}
        initialMarks={initialMarks}
        text={BLOCK}
        onCancel={onCancel}
        onSend={onSend}
        onFailed={onFailed}
      />
    </NextIntlClientProvider>
  )
  return { onCancel, onSend, onFailed }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function canvas(): HTMLCanvasElement {
  return screen.getByRole("img", { name: "Mark up the screenshot" })
}

// jsdom has no `PointerEvent`; a mouse event under the pointer's name, with
// the pointer's id on it, carries everything the canvas reads. `x`/`y` are
// relative to the picture's top-left corner on screen.
function pointer(
  type: string,
  x: number,
  y: number,
  target: Element = canvas(),
  pointerId = 1
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: ORIGIN.x + x,
    clientY: ORIGIN.y + y,
  })
  Object.defineProperty(event, "pointerId", { value: pointerId })
  fireEvent(target, event)
}

function drag(from: [number, number], to: [number, number]) {
  pointer("pointerdown", ...from)
  pointer("pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2)
  pointer("pointermove", ...to)
  pointer("pointerup", ...to)
}

function button(name: string) {
  return screen.getByRole("button", { name })
}

async function send() {
  await act(async () => {
    fireEvent.click(button("Save image"))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("ScreenshotMarkupDialog", () => {
  it("opens on the box tool with nothing drawn", async () => {
    setup()
    await settle()
    expect(canvas()).toHaveAttribute("width", "1600")
    expect(canvas()).toHaveAttribute("height", "1000")
    expect(button("Box")).toHaveAttribute("aria-pressed", "true")
    expect(button("Arrow")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText(/Drag across the picture to draw/)).toBeVisible()
    expect(button("Undo")).toBeDisabled()
    expect(button("Clear")).toBeDisabled()
    // The picture itself is on the canvas.
    expect(drawn.some((entry) => entry.startsWith("drawImage"))).toBe(true)
  })

  it("takes the keyboard without putting a focus ring on a tool", async () => {
    setup()
    await settle()
    expect(document.activeElement).toBe(screen.getByRole("dialog"))
  })

  it("draws a box where the pointer was dragged, in the picture's pixels", async () => {
    const { onSend } = setup()
    await settle()
    drag([300, 200], [100, 100])
    expect(screen.getByText("1 mark")).toBeVisible()
    expect(button("Undo")).toBeEnabled()
    await send()
    expect(onSend).toHaveBeenCalledTimes(1)
    const [{ image, text }] = onSend.mock.calls[0]
    expect(image).toBeInstanceOf(Blob)
    expect(image.type).toBe("image/png")
    // (100,100)–(300,200) on screen is (200,200)–(600,400) in the picture,
    // which is 400×200 image px at (200, 200) on the page.
    expect(text).toBe(
      `${BLOCK}- markup: the person drew 1 numbered mark on this screenshot, in red; the marks are not part of the original image\n` +
        "  1. box: 400×200 image px at (200, 200)\n"
    )
  })

  it("shows the mark being drawn, numbered, before the pointer lets go", async () => {
    setup()
    await settle()
    drawn.length = 0
    pointer("pointerdown", 100, 100)
    pointer("pointermove", 200, 200)
    expect(drawn).toContain("rect:200")
    expect(drawn).toContain("fillText:1")
    expect(screen.getByText(/Drag across the picture to draw/)).toBeVisible()
  })

  it("starts a drag pressed in the margin at the picture's edge", async () => {
    const { onSend } = setup()
    await settle()
    const well = canvas().parentElement as HTMLElement
    pointer("pointerdown", -12, 50, well)
    pointer("pointermove", 50, 100, well)
    pointer("pointerup", 100, 150, well)
    await send()
    // (-12,50) is held to the picture's left edge: (0,100)–(200,300) in the
    // picture, 200×200 image px at (0, 100) on the page.
    expect(onSend.mock.calls[0][0].text).toContain(
      "  1. box: 200×200 image px at (0, 100)\n"
    )
  })

  it("shows a mark only once the drag is long enough to keep", async () => {
    setup()
    await settle()
    pointer("pointerdown", 100, 100)
    drawn.length = 0
    pointer("pointermove", 103, 104)
    expect(drawn.some((entry) => entry.startsWith("rect"))).toBe(false)
    pointer("pointermove", 160, 160)
    expect(drawn.some((entry) => entry.startsWith("rect"))).toBe(true)
  })

  it("keeps a thin box drawn along a line of text", async () => {
    const { onSend } = setup()
    await settle()
    drag([100, 100], [300, 103])
    expect(screen.getByText("1 mark")).toBeVisible()
    await send()
    expect(onSend.mock.calls[0][0].text).toContain(
      "  1. box: 400×6 image px at (200, 200)\n"
    )
  })

  it("does not send with a mark still being drawn", async () => {
    const { onSend } = setup()
    await settle()
    pointer("pointerdown", 100, 100)
    pointer("pointermove", 300, 200)
    fireEvent.keyDown(button("Box"), { key: "Enter", metaKey: true })
    expect(onSend).not.toHaveBeenCalled()
    pointer("pointerup", 300, 200)
    await act(async () => {
      fireEvent.keyDown(button("Box"), { key: "Enter", metaKey: true })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0].text).toContain("1 numbered mark")
  })

  it("treats a click as a click, not as a mark", async () => {
    setup()
    await settle()
    drag([100, 100], [102, 101])
    expect(screen.getByText(/Drag across the picture to draw/)).toBeVisible()
    expect(button("Undo")).toBeDisabled()
  })

  it("draws an arrow pointing where the drag ended", async () => {
    const { onSend } = setup()
    await settle()
    fireEvent.click(button("Arrow"))
    expect(button("Arrow")).toHaveAttribute("aria-pressed", "true")
    drag([400, 400], [100, 100])
    await send()
    expect(onSend.mock.calls[0][0].text).toContain(
      "  1. arrow: pointing at (200, 200) image px, from (800, 800)\n"
    )
  })

  it("undoes the last mark, and undoes a clear", async () => {
    setup()
    await settle()
    drag([10, 10], [60, 60])
    drag([100, 100], [200, 200])
    expect(screen.getByText("2 marks")).toBeVisible()

    fireEvent.click(button("Undo"))
    expect(screen.getByText("1 mark")).toBeVisible()

    fireEvent.click(button("Clear"))
    expect(screen.getByText(/Drag across the picture to draw/)).toBeVisible()
    expect(button("Clear")).toBeDisabled()

    fireEvent.click(button("Undo"))
    expect(screen.getByText("1 mark")).toBeVisible()
  })

  it("undoes on ⌘Z and sends on ⌘Enter", async () => {
    const { onSend } = setup()
    await settle()
    drag([10, 10], [60, 60])
    drag([100, 100], [200, 200])
    fireEvent.keyDown(button("Box"), { key: "z", metaKey: true })
    expect(screen.getByText("1 mark")).toBeVisible()
    await act(async () => {
      fireEvent.keyDown(button("Box"), { key: "Enter", ctrlKey: true })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0].text).toContain("1 numbered mark")
  })

  it("sends the capture untouched when nothing was drawn", async () => {
    const { onSend } = setup()
    await settle()
    await send()
    expect(onSend).toHaveBeenCalledWith({ image: null, text: BLOCK, marks: [] })
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled()
  })

  it("sends a JPEG when the PNG would be too heavy for a model", async () => {
    encode = (type) =>
      new Blob([new Uint8Array(type === "image/png" ? 3_500_001 : 64)], {
        type,
      })
    const { onSend } = setup()
    await settle()
    drag([10, 10], [60, 60])
    await send()
    expect(onSend.mock.calls[0][0].image.type).toBe("image/jpeg")
  })

  it("sends nothing when closed while the picture is still being made", async () => {
    const { onCancel, onSend } = setup()
    await settle()
    drag([10, 10], [60, 60])
    heldEncodes = []
    await send()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    await act(async () => {
      for (const finish of heldEncodes ?? []) finish()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onSend).not.toHaveBeenCalled()
  })

  it("does not take a mark away while the picture is being made", async () => {
    const { onSend } = setup()
    await settle()
    drag([10, 10], [60, 60])
    drag([100, 100], [200, 200])
    heldEncodes = []
    await send()
    fireEvent.keyDown(button("Box"), { key: "z", metaKey: true })
    expect(screen.getByText("2 marks")).toBeVisible()
    await act(async () => {
      for (const finish of heldEncodes ?? []) finish()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onSend.mock.calls[0][0].text).toContain("2 numbered marks")
  })

  it("drops only the mark being drawn on Escape", async () => {
    const { onCancel } = setup()
    await settle()
    drag([10, 10], [60, 60])
    pointer("pointerdown", 100, 100)
    pointer("pointermove", 300, 300)
    drawn.length = 0
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    })
    // Redrawn with the mark already there, without the one being drawn.
    expect(drawn).toContain("rect:20")
    expect(drawn).not.toContain("rect:200")
    pointer("pointerup", 300, 300)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByText("1 mark")).toBeVisible()
  })

  it("drops the mark being drawn when the pointer is called off", async () => {
    setup()
    await settle()
    pointer("pointerdown", 100, 100)
    pointer("pointermove", 300, 300)
    drawn.length = 0
    pointer("pointercancel", 300, 300)
    // The half-drawn mark leaves the picture…
    expect(drawn.some((entry) => entry.startsWith("drawImage"))).toBe(true)
    expect(drawn.some((entry) => entry.startsWith("rect"))).toBe(false)
    // …and letting go afterwards adds nothing.
    pointer("pointerup", 300, 300)
    expect(screen.getByText(/Drag across the picture to draw/)).toBeVisible()
    expect(button("Undo")).toBeDisabled()
  })

  it("drops the mark being drawn when the picture loses the pointer", async () => {
    setup()
    await settle()
    pointer("pointerdown", 100, 100)
    pointer("pointermove", 300, 300)
    drawn.length = 0
    pointer("lostpointercapture", 300, 300)
    // The half-drawn mark leaves the picture…
    expect(drawn.some((entry) => entry.startsWith("drawImage"))).toBe(true)
    expect(drawn.some((entry) => entry.startsWith("rect"))).toBe(false)
    // …and letting go afterwards adds nothing.
    pointer("pointerup", 300, 300)
    expect(screen.getByText(/Drag across the picture to draw/)).toBeVisible()
    expect(button("Undo")).toBeDisabled()
  })

  // A second finger on a touch screen: whatever it does says nothing about
  // the drag the first one is drawing.
  it("follows only the pointer that started the drag", async () => {
    const { onSend } = setup()
    await settle()
    pointer("pointerdown", 100, 100)
    drawn.length = 0
    pointer("pointermove", 200, 200, canvas(), 2)
    expect(drawn.some((entry) => entry.startsWith("rect"))).toBe(false)
    pointer("pointercancel", 200, 200, canvas(), 2)
    pointer("lostpointercapture", 200, 200, canvas(), 2)
    pointer("pointerup", 400, 300, canvas(), 2)
    pointer("pointerup", 300, 200)
    expect(screen.getByText("1 mark")).toBeVisible()
    await send()
    // (100,100)–(300,200) on screen: the first pointer's drag.
    expect(onSend.mock.calls[0][0].text).toContain(
      "  1. box: 400×200 image px at (200, 200)\n"
    )
  })

  it("sends nothing when it is closed", async () => {
    const { onCancel, onSend } = setup()
    await settle()
    drag([10, 10], [60, 60])
    fireEvent.click(button("Cancel"))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("closes on Escape when nothing is being drawn", async () => {
    const { onCancel } = setup()
    await settle()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it("says so when the picture cannot be read", async () => {
    const { onFailed, onSend } = setup({ data: "broken" })
    await settle()
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("says nothing about a picture that failed after the sheet was closed", async () => {
    encode = () => null
    const { onCancel, onFailed } = setup()
    await settle()
    drag([10, 10], [60, 60])
    heldEncodes = []
    await send()
    fireEvent.click(button("Cancel"))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await act(async () => {
      for (const finish of heldEncodes ?? []) finish()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(toasts.error).not.toHaveBeenCalled()
    expect(onFailed).not.toHaveBeenCalled()
  })

  it("says so, and keeps what was drawn, when the marked picture cannot be made", async () => {
    encode = () => null
    const { onFailed, onSend } = setup()
    await settle()
    drag([10, 10], [60, 60])
    await send()
    expect(onSend).not.toHaveBeenCalled()
    // Not the end of the sheet, as an unreadable picture is.
    expect(onFailed).not.toHaveBeenCalled()
    expect(toasts.error).toHaveBeenCalledWith(
      "Could not save the marked image",
      { description: "Error: the marked-up screenshot could not be encoded" }
    )
    expect(screen.getByText("1 mark")).toBeVisible()
    expect(button("Save image")).toBeEnabled()
  })
})

it("uses the uploaded image dimensions when no browser capture metadata exists", async () => {
  const { onSend } = setup({ width: undefined, height: undefined })
  await settle()
  expect(canvas()).toHaveAttribute("width", "1600")
  expect(canvas()).toHaveAttribute("height", "1000")
  drag([100, 100], [300, 200])
  await send()
  expect(onSend.mock.calls[0][0].text).toContain(
    "400×200 image px at (200, 200)"
  )
})

it("keeps the annotations editable when replacement upload fails", async () => {
  const { onSend } = setup()
  onSend.mockRejectedValueOnce(new Error("upload quota"))
  await settle()
  drag([10, 10], [60, 60])
  await send()
  expect(toasts.error).toHaveBeenCalledWith("Could not save the marked image", {
    description: "Error: upload quota",
  })
  expect(button("Save image")).toBeEnabled()
  expect(screen.getByText("1 mark")).toBeVisible()
})

it("clearing saved marks exports the original image without stale annotation text", async () => {
  const { onSend } = setup({}, [
    { kind: "box", x: 20, y: 30, width: 80, height: 60 },
  ])
  await settle()
  expect(screen.getByText("1 mark")).toBeVisible()
  fireEvent.click(button("Clear"))
  await send()
  expect(onSend.mock.calls[0][0]).toEqual({
    image: expect.any(Blob),
    text: BLOCK,
    marks: [],
  })
})
