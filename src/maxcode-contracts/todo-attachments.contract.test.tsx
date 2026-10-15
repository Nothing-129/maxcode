import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { TodoEditorDialog } from "@/components/todos/todo-editor-dialog"
import { TodoAttachments } from "@/components/todos/todo-attachments"
import {
  parseTodoContent,
  serializeTodoContent,
  todoContentSummary,
  TODO_ATTACHMENT_MAX_BYTES,
} from "@/lib/todo-attachments"
import en from "@/i18n/messages/en.json"

function mount(content = "", onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TodoEditorDialog
        todo={null}
        draft={{ text: content }}
        members={[]}
        disabled={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    </NextIntlClientProvider>
  )
  return onSubmit
}
function paste(files: File[]) {
  fireEvent.paste(screen.getByLabelText("Todo content"), {
    clipboardData: { files, getData: () => "" },
  })
}

describe("MaxCode todo attachments", () => {
  it("pastes mixed files, previews images and saves portable bytes only on Save", async () => {
    const submit = mount("Keep this text")
    paste([
      new File(["image"], "shot.png", { type: "image/png" }),
      new File(["document"], "notes.txt", { type: "text/plain" }),
    ])
    await screen.findByRole("img", { name: "shot.png" })
    expect(screen.getByRole("link", { name: "notes.txt" })).toHaveAttribute(
      "download",
      "notes.txt"
    )
    expect(submit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    const saved = parseTodoContent(submit.mock.calls[0][0].content)
    expect(saved.text).toBe("Keep this text")
    expect(saved.attachments.map((file) => file.name)).toEqual([
      "shot.png",
      "notes.txt",
    ])
    expect(saved.attachments[1].data).toBe(
      "data:text/plain;base64,ZG9jdW1lbnQ="
    )
  })

  it("supports attachment-only todos and keeps bytes after backend whitespace trimming", async () => {
    const submit = mount()
    paste([new File(["hello"], "a.txt", { type: "text/plain" })])
    await screen.findByRole("link", { name: "a.txt" })
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    const content = submit.mock.calls[0][0].content.trim()
    expect(parseTodoContent(content).attachments).toHaveLength(1)
    expect(todoContentSummary(content)).toBe("a.txt")
  })

  it("loads saved attachments and removes them without changing text", async () => {
    const content = serializeTodoContent("Original", [
      { name: "saved.txt", data: "data:text/plain;base64,YQ==" },
    ])
    const submit = mount(content)
    expect(screen.getByLabelText("Todo content")).toHaveValue("Original")
    await userEvent.click(
      screen.getByRole("button", { name: "Remove saved.txt" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(submit.mock.calls[0][0].content).toBe("Original")
  })

  it("rejects oversized files and leaves existing text untouched", async () => {
    mount("Existing")
    const oversized = new File([], "large.bin")
    Object.defineProperty(oversized, "size", {
      value: TODO_ATTACHMENT_MAX_BYTES + 1,
    })
    paste([oversized])
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.Todos.attachmentTooLarge
    )
    expect(screen.getByLabelText("Todo content")).toHaveValue("Existing")
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("keeps Save disabled while reading and allows selecting files", async () => {
    mount("Text")
    const input = screen.getByLabelText(en.Todos.addAttachments, {
      selector: "input",
    })
    fireEvent.change(input, {
      target: { files: [new File(["test"], "selected.txt")] },
    })
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    )
    expect(
      screen.getByRole("link", { name: "selected.txt" })
    ).toBeInTheDocument()
  })

  it("preserves ordinary text and malformed envelopes, and never previews active formats", () => {
    expect(parseTodoContent("normal text")).toEqual({
      text: "normal text",
      attachments: [],
    })
    const literal = "text\n<!-- maxcode-todo-attachments:v1 -->\ninvalid"
    expect(parseTodoContent(literal).text).toBe(literal)
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TodoAttachments
          files={[{ name: "page.html", data: "data:text/html;base64,YQ==" }]}
        />
      </NextIntlClientProvider>
    )
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "page.html" })).toHaveAttribute(
      "download"
    )
  })

  it("supports file-kind clipboard items and leaves plain text paste to the textarea", async () => {
    mount("Text")
    const textarea = screen.getByLabelText("Todo content")
    const nativePaste = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(nativePaste, "clipboardData", {
      value: { files: [], getData: () => "plain text" },
    })
    fireEvent(textarea, nativePaste)
    expect(nativePaste.defaultPrevented).toBe(false)
    const file = new File(["linux"], "linux.txt", { type: "text/plain" })
    fireEvent.paste(textarea, {
      clipboardData: {
        files: [],
        items: [{ kind: "file", getAsFile: () => file }],
        getData: () => "",
      },
    })
    expect(
      await screen.findByRole("link", { name: "linux.txt" })
    ).toBeInTheDocument()
  })

  it("allows a combined 100 MiB and rejects one extra byte, including saved attachments", async () => {
    expect(TODO_ATTACHMENT_MAX_BYTES).toBe(100 * 1024 * 1024)
    mount(
      serializeTodoContent("Text", [
        { name: "existing.txt", data: "data:text/plain;base64,YQ==" },
      ])
    )
    const oversized = new File([], "over.bin")
    Object.defineProperty(oversized, "size", {
      value: TODO_ATTACHMENT_MAX_BYTES,
    })
    paste([oversized])
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.Todos.attachmentTooLarge
    )
    const exact = new File(["bytes"], "exact.bin")
    Object.defineProperty(exact, "size", {
      value: TODO_ATTACHMENT_MAX_BYTES - 1,
    })
    paste([exact])
    expect(
      await screen.findByRole("link", { name: "exact.bin" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps payloads out of title models and permits attachment sizes on local and team routes", () => {
    const title = readFileSync("src-tauri/src/session_title.rs", "utf8")
    expect(title).toContain(
      "redact_title_input(crate::todo::todo_text_content(content))"
    )
    const router = readFileSync("src-tauri/src/web/router.rs", "utf8")
    for (const handler of [
      "todo_call",
      "todo_origin_call",
      "team_todo_call",
      "team_todo_origin_call",
    ]) {
      expect(router).toMatch(
        new RegExp(
          `post\\(handlers::todo::${handler}\\)\\s*\\.layer\\(DefaultBodyLimit::max`
        )
      )
    }
  })
})
