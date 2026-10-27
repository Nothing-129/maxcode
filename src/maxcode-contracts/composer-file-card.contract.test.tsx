import { createRef } from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ReferenceBadge } from "@/components/chat/composer/badges/reference-badge"
import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"
import { serializeDocToText } from "@/components/chat/composer/to-prompt-blocks"
import type { ReferenceAttrs } from "@/components/chat/composer/types"
import { source } from "./contract-source"

afterEach(cleanup)

const audio: ReferenceAttrs = {
  refType: "file",
  id: "/tmp/clone-natural (2).wav",
  label: "clone-natural (2).wav",
  uri: "file:///tmp/clone-natural%20(2).wav",
  meta: { fileKind: "file" },
}

describe("composer file attachment cards", () => {
  it("shows a neutral audio card with a readable name, type and full-path tooltip", () => {
    const { container } = render(
      <ReferenceBadge data={audio} appearance="composer-file" />
    )
    const card = screen.getByRole("img", { name: `file: ${audio.label}` })
    expect(card).toHaveAttribute("data-composer-file-card")
    expect(card).toHaveAttribute("title", audio.uri)
    expect(card).toHaveClass("bg-muted/50", "text-foreground", "rounded-xl")
    expect(card).not.toHaveClass("text-blue-700")
    expect(
      container.querySelector('[data-file-icon="file-type-audio"]')
    ).not.toBeNull()
    expect(screen.getByText(audio.label)).toHaveClass("truncate")
    expect(screen.getByText("WAV")).toHaveAttribute("aria-hidden", "true")
  })

  it("does not change transcript links, non-file references, or invent metadata", () => {
    const { container } = render(
      <>
        <ReferenceBadge data={audio} />
        <ReferenceBadge data={audio} appearance="file-link" />
        <ReferenceBadge
          data={{ ...audio, refType: "session" }}
          appearance="composer-file"
        />
        <ReferenceBadge
          data={{ ...audio, id: "/tmp/README", label: "README" }}
          appearance="composer-file"
        />
      </>
    )
    expect(
      container.querySelectorAll("[data-composer-file-card]")
    ).toHaveLength(1)
    expect(screen.getByText("README")).toBeVisible()
    expect(screen.queryByText("WAV")).toBeNull()
  })

  it("renders real editor attachments as cards while preserving their prompt payload", async () => {
    const ref = createRef<RichComposerHandle>()
    const { container } = render(<RichComposer ref={ref} />)
    await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
    const editor = ref.current!.getEditor()!
    act(() => {
      editor.commands.insertReference(audio)
      editor.commands.insertContent(" Please inspect this audio.")
    })
    await waitFor(() =>
      expect(
        container.querySelector(
          "[data-editor-file-card] [data-composer-file-card]"
        )
      ).not.toBeNull()
    )
    const prompt = serializeDocToText(editor.state.doc)
    expect(prompt).toContain(audio.uri)
    expect(prompt).toContain(String.raw`clone-natural \(2\).wav`)
    expect(prompt).toContain("Please inspect this audio.")
    expect(prompt).not.toContain("WAV")
    expect(source("src/app/globals.css")).toContain(
      '.codeg-reference[data-composer-reference="file"]'
    )
  })
})
