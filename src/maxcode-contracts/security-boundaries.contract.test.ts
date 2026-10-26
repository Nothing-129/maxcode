import { afterEach, describe, expect, it, vi } from "vitest"
import { TODO_ATTACHMENT_MAX_BYTES, uploadTodoFile } from "@/lib/todo-storage"
import { source } from "./contract-source"

vi.mock("@/lib/transport/web-auth", () => ({
  getCodegToken: () => "test-token",
}))
afterEach(() => vi.unstubAllGlobals())

describe("Attachment and server security boundaries", () => {
  it.each(["personal", "team-a"])(
    "rejects oversized %s files before network transfer",
    async (scope) => {
      const fetch = vi.fn()
      vi.stubGlobal("fetch", fetch)
      const file = new File([], "large.bin")
      Object.defineProperty(file, "size", {
        value: TODO_ATTACHMENT_MAX_BYTES + 1,
      })
      await expect(uploadTodoFile(scope, file, "")).rejects.toThrow("100 MB")
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it("continues to send valid team attachments to the authenticated upload endpoint", async () => {
    const result = {
      name: "a.txt",
      url: "https://files.test/a",
      size: 1,
      mime: "text/plain",
    }
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => result })
    vi.stubGlobal("fetch", fetch)
    const file = new File(["a"], "a.txt")
    expect(await uploadTodoFile("team-a", file, "notes")).toEqual(result)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe("/api/todo_attachment_upload")
    expect(options.headers.Authorization).toBe("Bearer test-token")
    expect(options.body.get("scope_id")).toBe("team-a")
    expect(options.body.get("file").name).toBe(file.name)
    expect(options.body.get("file").size).toBe(file.size)
  })

  it("wires server protections and independent Rust boundary tests into the runtime", () => {
    expect(source("src-tauri/src/web/router.rs")).toContain(
      "super::security_headers::security_headers"
    )
    expect(source("src-tauri/src/web/security_headers.rs")).toContain(
      "server-security-headers.contract.rs"
    )
    expect(source("src-tauri/src/web/handlers/todo.rs")).toContain(
      "todo-upload-bounds.contract.rs"
    )
  })
})
