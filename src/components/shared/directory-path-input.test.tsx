import { useState } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { DirectoryPathInput } from "./directory-path-input"

const api = vi.hoisted(() => ({
  getHomeDirectory: vi.fn(),
  listDirectoryEntries: vi.fn(),
}))
vi.mock("@/lib/api", () => api)

const platform = vi.hoisted(() => ({
  desktop: false,
  openFileDialog: vi.fn(),
}))
vi.mock("@/lib/platform", () => ({
  isLocalDesktop: () => platform.desktop,
  openFileDialog: platform.openFileDialog,
}))
vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: () => null,
}))

function Harness({ nested = false }: { nested?: boolean }) {
  const [value, setValue] = useState("")
  const field = (
    <DirectoryPathInput
      value={value}
      onValueChange={setValue}
      placeholder="Where to?"
      browseLabel="Browse directory"
    />
  )
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {nested ? (
        // The in-app browser is a Dialog rendered from inside another Dialog's
        // content — the arrangement every host now uses.
        <Dialog open>
          <DialogContent>
            <DialogTitle>Host</DialogTitle>
            {field}
          </DialogContent>
        </Dialog>
      ) : (
        field
      )}
    </NextIntlClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  platform.desktop = false
  api.getHomeDirectory.mockResolvedValue("/home/me")
  api.listDirectoryEntries.mockResolvedValue([])
})

describe("DirectoryPathInput", () => {
  it("edits the path directly", () => {
    render(<Harness />)
    fireEvent.change(screen.getByPlaceholderText("Where to?"), {
      target: { value: "/typed/dir" },
    })
    expect(screen.getByDisplayValue("/typed/dir")).toBeInTheDocument()
  })

  it("fills the box from the system picker without opening a browser", async () => {
    platform.desktop = true
    platform.openFileDialog.mockResolvedValue("/home/me/picked")
    render(<Harness />)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Browse directory" }))
    })

    expect(platform.openFileDialog).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
    })
    expect(screen.getByDisplayValue("/home/me/picked")).toBeInTheDocument()
    expect(api.getHomeDirectory).not.toHaveBeenCalled()
  })

  it("falls back to the in-app browser when there is no local desktop", async () => {
    api.listDirectoryEntries.mockResolvedValue([
      { name: "work", path: "/home/me/work", hasChildren: false },
    ])
    render(<Harness />)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Browse directory" }))
    })
    expect(platform.openFileDialog).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole("button", { name: /work/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select" }))
    })

    expect(screen.getByDisplayValue("/home/me/work")).toBeInTheDocument()
  })

  it("keeps the host dialog open while the nested browser runs", async () => {
    api.listDirectoryEntries.mockResolvedValue([
      { name: "work", path: "/home/me/work", hasChildren: false },
    ])
    render(<Harness nested />)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Browse directory" }))
    })
    fireEvent.click(await screen.findByRole("button", { name: /work/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select" }))
    })

    expect(screen.getByText("Host")).toBeInTheDocument()
    expect(screen.getByDisplayValue("/home/me/work")).toBeInTheDocument()
  })
})
