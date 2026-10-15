/** Attachments travel with content so remote teams retain the same files. */
export const TODO_ATTACHMENT_MARKER = "<!-- maxcode-todo-attachments:v1 -->\n"
export const TODO_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024
export interface TodoAttachment {
  name: string
  data: string
}

export function parseTodoContent(content: string): {
  text: string
  attachments: TodoAttachment[]
} {
  const index = content.lastIndexOf(TODO_ATTACHMENT_MARKER)
  if (index >= 0) {
    try {
      const attachments: unknown = JSON.parse(
        content.slice(index + TODO_ATTACHMENT_MARKER.length)
      )
      if (
        Array.isArray(attachments) &&
        attachments.length > 0 &&
        attachments.every(
          (file) =>
            typeof file?.name === "string" &&
            typeof file?.data === "string" &&
            /^data:[\w.+/-]*;base64,[A-Za-z0-9+/]*={0,2}$/.test(file.data)
        )
      ) {
        return { text: content.slice(0, index).trimEnd(), attachments }
      }
    } catch {
      // Literal text resembling our envelope must remain editable.
    }
  }
  return { text: content, attachments: [] }
}

export function serializeTodoContent(text: string, files: TodoAttachment[]) {
  return files.length
    ? (text.trim() ? text.trim() + "\n\n" : "") +
        TODO_ATTACHMENT_MARKER +
        JSON.stringify(files)
    : text.trim()
}

export function todoAttachmentBytes(files: TodoAttachment[]) {
  return files.reduce((total, file) => {
    const data = file.data.slice(file.data.indexOf(",") + 1)
    return total + (data.length * 3) / 4 - (data.match(/=+$/)?.[0].length ?? 0)
  }, 0)
}

export function readTodoAttachment(file: File): Promise<TodoAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({ name: file.name, data: String(reader.result) })
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"))
    reader.onabort = () => reject(new Error("File read cancelled"))
    const type = /^[\w.+/-]+$/.test(file.type)
      ? file.type
      : "application/octet-stream"
    reader.readAsDataURL(file.slice(0, file.size, type))
  })
}

export function todoContentSummary(content: string) {
  const { text, attachments } = parseTodoContent(content)
  return [text, ...attachments.map((file) => file.name)]
    .filter(Boolean)
    .join("\n")
}
