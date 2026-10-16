import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TodoEditorDialog } from "@/components/todos/todo-editor-dialog"
import { TodoMarkdown } from "@/components/todos/todo-markdown"
import { TODO_ATTACHMENT_MAX_BYTES } from "@/lib/todo-storage"
import { uploadTodoFile, todoFileMarkdown } from "@/lib/todo-storage"
import en from "@/i18n/messages/en.json"

vi.mock("@/lib/todo-storage", async (original) => ({
  ...(await original<typeof import("@/lib/todo-storage")>()),
  uploadTodoFile: vi.fn(),
}))
beforeEach(() => {
  vi.mocked(uploadTodoFile)
    .mockReset()
    .mockImplementation(async (_, file) => ({
      name: file.name,
      url: `https://minio.test/bucket/${encodeURIComponent(file.name)}`,
      size: file.size,
      mime: file.type,
    }))
})
function mount(content = "", scopeId = "personal") {
  const submit = vi.fn().mockResolvedValue(undefined)
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TodoEditorDialog
        todo={null}
        draft={{ text: content }}
        members={[]}
        disabled={false}
        onClose={vi.fn()}
        onSubmit={submit}
        scopeId={scopeId}
      />
    </NextIntlClientProvider>
  )
  return submit
}
function paste(files: File[]) {
  fireEvent.paste(screen.getByLabelText("Todo content"), {
    clipboardData: { files, getData: () => "" },
  })
}

describe("MaxCode todo Markdown and URL attachments", () => {
  it("uploads to the captured team scope, inserts images at the cursor and previews inline", async () => {
    const submit = mount("before after", "team-a")
    const textarea = screen.getByLabelText(
      "Todo content"
    ) as HTMLTextAreaElement
    textarea.setSelectionRange(7, 7)
    const image = new File(["image"], "shot.png", { type: "image/png" })
    paste([image])
    expect(
      await screen.findByRole("img", { name: "shot.png" })
    ).toHaveAttribute("src", "https://minio.test/bucket/shot.png")
    expect(uploadTodoFile).toHaveBeenCalledWith("team-a", image, "before after")
    expect(textarea.value).toBe(
      "before \n![shot.png](https://minio.test/bucket/shot.png)\nafter"
    )
    expect(
      screen.queryByRole("button", { name: "Remove shot.png" })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(submit.mock.calls[0][0].content).toBe(textarea.value.trim())
    expect(submit.mock.calls[0][0].content).not.toMatch(
      /base64|maxcode-todo-attachments/
    )
  })
  it("inserts a normal file as a Markdown link and permits file-only todos", async () => {
    const submit = mount()
    paste([new File(["document"], "notes.txt", { type: "text/plain" })])
    expect(
      await screen.findByRole("link", { name: "notes.txt" })
    ).toHaveAttribute("href", "https://minio.test/bucket/notes.txt")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(submit.mock.calls[0][0].content).toBe(
      "[notes.txt](https://minio.test/bucket/notes.txt)"
    )
  })
  it("retains original text when upload fails, without inserting an unusable URL", async () => {
    mount("Keep this")
    vi.mocked(uploadTodoFile).mockRejectedValueOnce(
      new Error("MinIO unavailable")
    )
    paste([new File(["x"], "fail.png", { type: "image/png" })])
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "MinIO unavailable"
    )
    expect(screen.getByLabelText("Todo content")).toHaveValue("Keep this")
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })
  it("keeps successfully uploaded files in the draft if a later file fails", async () => {
    mount()
    vi.mocked(uploadTodoFile)
      .mockResolvedValueOnce({
        name: "first.txt",
        url: "https://minio.test/first.txt",
        size: 1,
        mime: "text/plain",
      })
      .mockRejectedValueOnce(new Error("Failed second file"))
    paste([new File(["a"], "first.txt"), new File(["b"], "second.txt")])
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed second file"
    )
    expect(screen.getByLabelText("Todo content")).toHaveValue(
      "\n[first.txt](https://minio.test/first.txt)\n"
    )
  })
  it("rejects more than 100 MiB before uploading", async () => {
    expect(TODO_ATTACHMENT_MAX_BYTES).toBe(100 * 1024 * 1024)
    mount("Existing")
    const file = new File([], "large.bin")
    Object.defineProperty(file, "size", {
      value: TODO_ATTACHMENT_MAX_BYTES + 1,
    })
    paste([file])
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.Todos.attachmentTooLarge
    )
    expect(uploadTodoFile).not.toHaveBeenCalled()
  })
  it("disables saving while uploading and supports the file picker", async () => {
    mount("Text")
    let finish!: (value: Awaited<ReturnType<typeof uploadTodoFile>>) => void
    vi.mocked(uploadTodoFile).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    fireEvent.change(
      screen.getByLabelText(en.Todos.addAttachments, { selector: "input" }),
      { target: { files: [new File(["test"], "selected.txt")] } }
    )
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await waitFor(() => expect(uploadTodoFile).toHaveBeenCalled())
    finish({
      name: "selected.txt",
      url: "https://minio.test/selected.txt",
      size: 4,
      mime: "text/plain",
    })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    )
  })
  it("keeps Markdown formatting visible while editing and uses safe link rendering", () => {
    mount("## Heading\n\n**Bold**\n\n[unsafe](javascript:alert%281%29)")
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument()
    expect(screen.getByText("Bold").tagName).toBe("STRONG")
    expect(
      screen.queryByRole("link", { name: "unsafe" })
    ).not.toBeInTheDocument()
  })
  it("allows MinIO team uploads above the personal size limit", async () => {
    mount("Team upload", "team-a")
    const file = new File(["large"], "large.bin")
    Object.defineProperty(file, "size", {
      value: TODO_ATTACHMENT_MAX_BYTES + 1,
    })
    fireEvent.paste(screen.getByLabelText("Todo content"), {
      clipboardData: { files: [file], items: [], getData: () => "" },
    })
    await waitFor(() => expect(uploadTodoFile).toHaveBeenCalled())
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
  it("saves existing Markdown URLs without uploading again", async () => {
    const content = "Original\n\n[report](https://minio.test/bucket/report.txt)"
    const submit = mount(content, "team-a")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0].content).toBe(content)
    expect(uploadTodoFile).not.toHaveBeenCalled()
  })
  it("supports Linux file-kind clipboard items without hijacking ordinary text", async () => {
    mount("Text")
    const textarea = screen.getByLabelText("Todo content")
    const event = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", {
      value: { files: [], getData: () => "plain text" },
    })
    fireEvent(textarea, event)
    expect(event.defaultPrevented).toBe(false)
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
  it("escapes filenames and URL parentheses without breaking Markdown", () => {
    const markdown = todoFileMarkdown({
      name: "[demo](1).png",
      url: "https://minio.test/(1).png",
      size: 1,
      mime: "image/png",
    })
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TodoMarkdown content={markdown} />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://minio.test/%281%29.png"
    )
  })
})
