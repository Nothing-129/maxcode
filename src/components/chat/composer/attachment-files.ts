/**
 * Pure file/blob helpers shared by every composer that can take attachments.
 *
 * Extracted verbatim from `message-input.tsx` so the conversation composer and
 * the to-do task composers classify, name and encode a dropped/pasted/picked
 * file exactly the same way — one MIME table, one base64 reader, one "is this
 * text-like" rule. Nothing here touches React or the editor except
 * {@link editorHasFileReference}, which only reads a Tiptap document.
 */

import type { Editor } from "@tiptap/core"

import { randomUUID } from "@/lib/utils"

const MIME_BY_EXT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/tsx",
  jsx: "text/jsx",
  py: "text/x-python",
  rs: "text/rust",
  go: "text/x-go",
  java: "text/x-java-source",
  xml: "application/xml",
  toml: "application/toml",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
}

export function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export function mimeTypeFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXT[ext] ?? null
}

export function hasDragFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer?.types) return false
  return Array.from(dataTransfer.types).includes("Files")
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read blob"))
    }
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unexpected non-string blob reader result"))
        return
      }
      const markerIndex = reader.result.indexOf(",")
      resolve(
        markerIndex >= 0 ? reader.result.slice(markerIndex + 1) : reader.result
      )
    }
    reader.readAsDataURL(blob)
  })
}

export function getFilePath(file: File): string | null {
  const withPath = file as File & { path?: string; webkitRelativePath?: string }
  if (typeof withPath.path === "string" && withPath.path.trim().length > 0) {
    return withPath.path
  }
  if (
    typeof withPath.webkitRelativePath === "string" &&
    withPath.webkitRelativePath.trim().length > 0
  ) {
    return withPath.webkitRelativePath
  }
  return null
}

const TEXT_LIKE_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/javascript",
  "application/typescript",
]

export function isTextLikeFile(file: File): boolean {
  const mime = file.type.toLowerCase()
  if (mime) {
    if (TEXT_LIKE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
      return true
    }
  }
  const ext = file.name.split(".").pop()?.toLowerCase()
  if (!ext) return false
  return Boolean(
    MIME_BY_EXT[ext]?.startsWith("text/") ||
    ["json", "yaml", "yml", "xml", "toml", "md", "csv"].includes(ext)
  )
}

export function buildClipboardResourceUri(name: string): string {
  const normalizedName = name.trim() || "clipboard-resource"
  return `clipboard://${encodeURIComponent(normalizedName)}-${randomUUID()}`
}

export function buildDataUri(
  base64Data: string,
  mimeType: string | null
): string {
  const safeMime =
    mimeType && mimeType.trim() ? mimeType : "application/octet-stream"
  return `data:${safeMime};base64,${base64Data}`
}

/** Whether the document already holds a `refType` reference badge for `uri`. */
export function editorHasReference(
  editor: Editor,
  refType: string,
  uri: string
): boolean {
  let found = false
  editor.state.doc.descendants((node) => {
    if (found) return false
    if (
      node.type.name === "reference" &&
      node.attrs?.refType === refType &&
      node.attrs?.uri === uri
    ) {
      found = true
      return false
    }
    return true
  })
  return found
}

/** Whether the document already holds a file reference badge for `uri` (used to
 *  dedupe repeated drops/picks of the same path, mirroring the old seen-set). */
export function editorHasFileReference(editor: Editor, uri: string): boolean {
  return editorHasReference(editor, "file", uri)
}
