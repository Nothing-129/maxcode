import { useState, type ReactElement } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import { mermaidComponents } from "./mermaid-block"

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  getMermaid: vi.fn(),
  copyTextToClipboard: vi.fn(async () => true),
  saveDiagram: vi.fn(async () => "saved" as const),
  /** Flips the mocked appearance context — see the mock factory below. */
  setDarkMode: (() => {}) as (on: boolean) => void,
}))

// Stand in for the lazily-imported `@streamdown/mermaid` singleton. The real
// engine needs a layout-capable DOM; what matters here is that the block calls
// it with the right config and renders whatever SVG comes back.
vi.mock("./streamdown-plugins", () => ({
  useMermaidEngine: () => ({
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid: mocks.getMermaid,
  }),
}))

// `useAppearance` is a context in the app, so a theme change re-renders the
// block straight through the `memo` around it. Backing the mock with real state
// reproduces that: `setDarkMode` updates from inside the component.
vi.mock("@/hooks/use-appearance", () => ({
  useAppearance: () => {
    const [isDarkMode, setIsDarkMode] = useState(false)
    mocks.setDarkMode = setIsDarkMode
    return { isDarkMode }
  },
}))

vi.mock("@/lib/mermaid-export", () => ({ saveDiagram: mocks.saveDiagram }))

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  copyTextToClipboard: mocks.copyTextToClipboard,
}))

const SOURCE = "graph TD;\n  A-->B;"
const SVG =
  '<svg viewBox="0 0 400 300" style="max-width: 400px;" width="100%">' +
  '<g data-testid="diagram-body"></g></svg>'

const Pre = mermaidComponents.pre as React.ComponentType<{
  children?: React.ReactNode
}>

function mermaidFence(source = SOURCE): ReactElement {
  return (
    <Pre>
      <code className="language-mermaid">{source}</code>
    </Pre>
  )
}

function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.render.mockResolvedValue({ svg: SVG })
  mocks.getMermaid.mockImplementation(() => ({
    initialize: vi.fn(),
    render: mocks.render,
  }))
})

describe("mermaidComponents.pre", () => {
  it("renders a ```mermaid fence as a diagram block", async () => {
    const { container } = renderWithIntl(mermaidFence())

    await waitFor(() =>
      expect(
        container.querySelector('[data-codeg="mermaid-block"]')
      ).not.toBeNull()
    )
    expect(mocks.render).toHaveBeenCalledWith(expect.any(String), SOURCE)
    expect(container.querySelector("svg")).not.toBeNull()
  })

  it("strips Mermaid's inline max-width, which would cap every zoom", async () => {
    const { container } = renderWithIntl(mermaidFence())

    const svg = await waitFor(() => {
      const el = container.querySelector("svg")
      expect(el).not.toBeNull()
      return el as SVGElement
    })
    expect(svg.getAttribute("style") ?? "").not.toMatch(/max-width/i)
  })

  it("passes every other fence through with Streamdown's data-block flag", () => {
    const { container } = renderWithIntl(
      <Pre>
        <code className="language-ts">const a = 1</code>
      </Pre>
    )

    const code = container.querySelector("code")
    expect(code?.getAttribute("data-block")).toBe("true")
    expect(container.querySelector('[data-codeg="mermaid-block"]')).toBeNull()
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it("renders non-element children untouched", () => {
    const { container } = renderWithIntl(<Pre>plain text</Pre>)
    expect(container.textContent).toBe("plain text")
  })
})

describe("MermaidBlock theming", () => {
  it("renders with Mermaid's light theme by default", async () => {
    renderWithIntl(mermaidFence())
    await waitFor(() =>
      expect(mocks.getMermaid).toHaveBeenCalledWith({ theme: "default" })
    )
  })

  it("re-renders the diagram with the dark theme when the app turns dark", async () => {
    renderWithIntl(mermaidFence())
    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1))

    act(() => mocks.setDarkMode(true))

    await waitFor(() =>
      expect(mocks.getMermaid).toHaveBeenLastCalledWith({ theme: "dark" })
    )
    expect(mocks.render).toHaveBeenCalledTimes(2)
  })
})

describe("MermaidBlock toolbar", () => {
  it("offers download, copy and fullscreen once the diagram is up", async () => {
    renderWithIntl(mermaidFence())

    expect(await screen.findByLabelText("Download")).toBeTruthy()
    expect(screen.getByLabelText("Copy source")).toBeTruthy()
    expect(screen.getByLabelText("View fullscreen")).toBeTruthy()
    expect(screen.getByLabelText("Zoom in")).toBeTruthy()
    expect(screen.getByLabelText("Reset view")).toBeTruthy()
  })

  it("copies the fence source, not the rendered SVG", async () => {
    renderWithIntl(mermaidFence())

    fireEvent.click(await screen.findByLabelText("Copy source"))

    await waitFor(() =>
      expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(SOURCE)
    )
    expect(await screen.findByLabelText("Copied")).toBeTruthy()
  })

  it("opens the fullscreen dialog", async () => {
    renderWithIntl(mermaidFence())

    fireEvent.click(await screen.findByLabelText("View fullscreen"))

    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain("Diagram")
    expect(dialog.querySelector("svg")).not.toBeNull()
    expect(screen.getByLabelText("Close")).toBeTruthy()
  })
})

describe("MermaidBlock errors", () => {
  it("shows the failure with the source, and retries on demand", async () => {
    mocks.render.mockRejectedValueOnce(new Error("Parse error on line 2"))
    const { container } = renderWithIntl(mermaidFence())

    expect(
      await screen.findByText(/Mermaid error: Parse error on line 2/)
    ).toBeTruthy()
    expect(screen.getByText("Show source")).toBeTruthy()
    // Verbatim, not via getByText: its string matcher compares against
    // whitespace-collapsed node text, which would pass on a mangled fence.
    expect(container.querySelector("pre")?.textContent).toBe(SOURCE)

    fireEvent.click(screen.getByText("Retry"))

    await waitFor(() =>
      expect(
        document.querySelector('[data-codeg="mermaid-block"]')
      ).not.toBeNull()
    )
  })

  it("keeps the last good drawing when a re-render fails", async () => {
    const { container } = renderWithIntl(mermaidFence())
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull())

    mocks.render.mockRejectedValueOnce(new Error("boom"))
    act(() => mocks.setDarkMode(true))

    await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2))
    // Stale colours beat an empty card.
    expect(container.querySelector("svg")).not.toBeNull()
    expect(screen.queryByText("Retry")).toBeNull()
  })
})
