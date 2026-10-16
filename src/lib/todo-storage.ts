import { getTransport } from "./transport"
import { getCodegToken } from "./transport/web-auth"
import { notifyWebUnauthorized } from "./transport/web-connection-store"

export interface TodoMinioConfig {
  endpoint: string
  bucket: string
  public_url: string
  access_key: string
  secret_key: string
  region: string
  has_secret?: boolean
}
export const emptyMinioConfig = (): TodoMinioConfig => ({
  endpoint: "",
  bucket: "",
  public_url: "",
  access_key: "",
  secret_key: "",
  region: "us-east-1",
})
export function todoStorageConfig(scopeId: string, config?: TodoMinioConfig) {
  return getTransport().call<TodoMinioConfig | null>("todo_storage_config", {
    scope_id: scopeId,
    config: config ?? null,
  })
}
export interface TodoUploadedFile {
  name: string
  url: string
  size: number
  mime: string
}
export async function uploadTodoFile(
  scopeId: string,
  file: File,
  content: string
): Promise<TodoUploadedFile> {
  const form = new FormData()
  form.append("scope_id", scopeId)
  form.append("content", content)
  form.append("file", file, file.name)
  const response = await fetch("/api/todo_attachment_upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${getCodegToken()}` },
    body: form,
  })
  if (response.status === 401) notifyWebUnauthorized()
  if (!response.ok)
    throw await response
      .json()
      .catch(() => new Error(`Upload failed: HTTP ${response.status}`))
  return response.json()
}
export function todoFileMarkdown(file: TodoUploadedFile) {
  const label = file.name
    .replace(/[\\[\]`*_<>]/g, "\\$&")
    .replace(/[\r\n]/g, " ")
  const url = file.url.replace(/[()\s<>]/g, (char) =>
    encodeURIComponent(char).replace(/\(/g, "%28").replace(/\)/g, "%29")
  )
  return `${file.mime.startsWith("image/") ? "!" : ""}[${label}](${url})`
}

export const TODO_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024
